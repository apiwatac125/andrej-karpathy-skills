"""Parse all Lerdsin antibiogram years (2018-2025) into unified app DATA JSON.
Strata key = 'origin|specimen|ward', origin in {ALL,CAI,HAI}, specimen in {ALL,Blood,Sputum,Urine}, ward in {ALL,MICU,SICU}
Output DATA: {meta:{...}, organisms:{org:{strata:{key:{N:{yr:n}, drugs:{drug:{yr:{S,n}}}}}}}}
"""
import openpyxl, re, json, os, glob
from collections import defaultdict

YEARS_DIR = os.path.join(os.path.dirname(__file__), "years")

INTR = defaultdict(set)  # organism -> {drugs marked intrinsically resistant ("R")}
def is_intrinsic(v):
    return v is not None and str(v).strip().upper() == "R"

def norm_org(o):
    o = re.sub(r"\s+", " ", str(o)).strip().rstrip("*").strip()
    o = re.sub(r"\s*\((?:overall)\)\s*$", "", o, flags=re.I)  # strip trailing (Overall)
    low = o.lower()
    if "coagulase" in low and "staph" in low: return "Coagulase-negative Staphylococci"
    if low.startswith("beta") and "strept" in low: return "Beta-hemolytic Streptococci"
    if "viridan" in low: return "Viridans group Streptococci"
    if "other enterobacter" in low: return "Other Enterobacterales"
    if low.startswith("burkh"): return "Burkholderia species"
    if low in ("escerichai coli","escherichai coli"): return "Escherichia coli"
    if low in ("pseudomonas speices","pseudomonas spiecies"): return "Pseudomonas species"
    if low == "streptococcus pneumoniae": return "Streptococcus pneumoniae"
    fixes = {
        "Staphylococcus Coagulase-negative": "Coagulase-negative Staphylococci",
        "Beta hemolysis Streptococci": "Beta-hemolytic Streptococci",
        "Serratia species": "Serratia species",
    }
    return fixes.get(o, o)

DRUG_RENAME = {
    "Piperacil/Tazob": "Piperacillin/Tazobactam",
    "Cefoperazone/Su": "Cefoperazone/Sulbactam",
    "Trimetho/Sulfa.": "Trimethoprim/Sulfa",
    "Trimetho/Sulfa": "Trimethoprim/Sulfa",
    "Ceftazidime/avi": "Ceftazidime/avibactam",
}
def norm_drug(d):
    d = re.sub(r"\s+", " ", str(d)).strip()
    return DRUG_RENAME.get(d, d)

SKIP_ORG = re.compile(r"\((?:ESBL|CRE|carbapenem|AmpC)|producing strain|\bMDR\b|\bVRE\b|\bMRSA\b|\bMRCoNS\b|non-?CRE|non-?MDR|\bCoRO\b|\bCRAB\b|\bCRPA\b|\bDRSM\b|\bMSSA\b", re.I)
MIN_N = 30  # CLSI M39: report an organism only when >=30 first isolates

def pint(v):
    if v is None: return None
    if isinstance(v,(int,float)) and not isinstance(v,bool): return int(round(v))
    s=str(v)
    m=re.search(r"-?\d+", s.replace(",",""))
    return int(m.group()) if m else None

def pct(v):
    """percent-susceptible cell -> int or None (skip R/-/blank)."""
    if v is None: return None
    if isinstance(v,(int,float)) and not isinstance(v,bool): return int(round(v))
    s=str(v).strip()
    if s=="" or s.upper()=="R" or s=="-" or s=="\\-": return None
    m=re.fullmatch(r"\(?-?\d+(?:\.\d+)?\)?", s)
    if m:
        return int(round(float(s.strip("()"))))
    return None

def scope_from_label(lab, base):
    """Return (origin,specimen,ward) starting from base, applying hints in label text."""
    o,sp,w = base
    s=lab.lower()
    if "community" in s or re.search(r"\bcai\b", s): o="CAI"
    elif "hospital" in s or re.search(r"\bhai\b", s): o="HAI"
    if "hemoculture" in s or "blood" in s: sp="Blood"
    elif "sputum" in s: sp="Sputum"
    elif "urine" in s: sp="Urine"
    if "medical intensive" in s or "icumed" in s or re.search(r"\bmicu\b",s): w="MICU"
    elif "surgical intensive" in s or "icusurg" in s or re.search(r"\bsicu\b",s): w="SICU"
    return (o,sp,w)

def sheet_base(name):
    n=name.strip().lower()
    if re.search(r"^(antibiogram|aniobiogram|all\d|allabg|alg)", n) or "all ward" in n or "all specimen" in n:
        return ("ALL","ALL","ALL")
    # OPD/IPD -> skip (not CAI/HAI acquisition)
    if re.match(r"^(opd|ipd)\b", n): return None
    o="ALL"; sp="ALL"; w="ALL"
    if n.startswith("hai"): o="HAI"
    elif n.startswith("cai"): o="CAI"
    if "hemoculture" in n or "hemculture" in n: sp="Blood"
    elif "sputum" in n: sp="Sputum"
    elif "urine" in n: sp="Urine"
    if "icumed" in n: w="MICU"
    elif "icusurg" in n: w="SICU"
    if o=="ALL" and sp=="ALL" and w=="ALL" and not re.search(r"(antibiogram|all)", n):
        # a named sheet we didn't map -> default ALL|ALL|ALL only if it is the main; else keep ALL
        pass
    return (o,sp,w)

def parse_sheet(ws, base):
    """Yield (stratum_tuple, org, N, {drug:{S,n}}) for all overall rows in sheet."""
    rows=list(ws.iter_rows(values_only=True))
    n=len(rows)
    def cell(r,c): return r[c] if r and c<len(r) and r[c] is not None else None
    # locate all 'Organism Name' headers
    heads=[i for i,r in enumerate(rows) if r and r[0] and str(r[0]).strip().lower()=="organism name"]
    out=[]
    for hi,h in enumerate(heads):
        # layout detection
        c1=cell(rows[h],1); c2=cell(rows[h],2)
        fmtA = (c1 is not None and str(c1).strip().lower()=="resist")
        if fmtA:
            qcol=1; numcol=2; dstart=3
        else:
            qcol=None; numcol=1; dstart=2
        drow=rows[h+1]
        drugmap={}
        maxc=max(len(rows[h]), len(drow))
        for c in range(dstart, maxc):
            nm=cell(drow,c)
            if nm not in (None,""):
                drugmap[c]=norm_drug(nm)
        # section stratum: label text above header (within 2 rows) in col0
        lab=""
        j=h-1
        while j>=0 and (not rows[j] or rows[j][0] in (None,"")):
            j-=1
        if j>=0 and rows[j][0] and str(rows[j][0]).strip().lower()!="organism name":
            lab=str(rows[j][0]).replace("\n"," ").strip()
        strat = scope_from_label(lab, base) if lab else base
        # data range
        end = heads[hi+1]-1 if hi+1<len(heads) else n
        i=h+2
        seen=set()
        while i<end:
            r=rows[i]
            org=cell(r,0)
            num=pint(cell(r,numcol))
            if org not in (None,"") and num is not None:
                if fmtA:
                    q=cell(r,qcol)
                    if q not in (None,"") and str(q).strip()!="":
                        i+=1; continue  # phenotype row (CRE/MDR/...), skip
                if SKIP_ORG.search(str(org)):
                    i+=2; continue
                orgn=norm_org(org)
                nrow=rows[i+1] if i+1<end else None
                drugs={}
                for c,dn in drugmap.items():
                    raw=cell(r,c)
                    if is_intrinsic(raw): INTR[orgn].add(dn); continue
                    s=pct(raw)
                    if s is None: continue
                    nn=pint(cell(nrow,c)) if nrow else None
                    drugs[dn]={"S":int(s),"n":int(nn) if nn else int(num)}
                if drugs and orgn not in seen:
                    seen.add(orgn)
                    out.append((strat,orgn,int(num),drugs))
                i+=2
            else:
                i+=1
    return out

def parse_old(ws, year):
    """2018 old format: header row has 'Organism Name' col0, Number col2, drugs col3+ (from header row)."""
    rows=list(ws.iter_rows(values_only=True))
    n=len(rows)
    def cell(r,c): return r[c] if r and c<len(r) and r[c] is not None else None
    heads=[i for i,r in enumerate(rows) if r and r[0] and str(r[0]).strip().lower()=="organism name"]
    out=[]
    for hi,h in enumerate(heads):
        # drug names in header row itself from col3
        drugmap={}
        maxc=len(rows[h])
        for c in range(3,maxc):
            nm=cell(rows[h],c)
            if nm not in (None,""): drugmap[c]=norm_drug(nm)
        numcol=2; qcol=1
        end = heads[hi+1]-1 if hi+1<len(heads) else n
        i=h+1; seen=set()
        while i<end:
            r=rows[i]; org=cell(r,0); num=pint(cell(r,numcol))
            if org not in (None,"") and num is not None:
                q=cell(r,qcol)
                if q not in (None,"") and str(q).strip()!="":
                    i+=1; continue
                if SKIP_ORG.search(str(org)):
                    i+=2; continue
                orgn=norm_org(org)
                nrow=rows[i+1] if i+1<end else None
                drugs={}
                for c,dn in drugmap.items():
                    raw=cell(r,c)
                    if is_intrinsic(raw): INTR[orgn].add(dn); continue
                    s=pct(raw)
                    if s is None: continue
                    nn=pint(cell(nrow,c)) if nrow else None
                    drugs[dn]={"S":int(s),"n":int(nn) if nn else int(num)}
                if drugs and orgn not in seen:
                    seen.add(orgn); out.append((("ALL","ALL","ALL"),orgn,int(num),drugs))
                i+=2
            else: i+=1
    return out

def parse_2019(path):
    out=[]
    lines=[l.rstrip("\n") for l in open(path) if l.strip()]
    hdr=lines[0].split("|")
    drugs_cols=hdr[4:]  # after row,org,qual,N
    for ln in lines[1:]:
        p=ln.split("|")
        org=norm_org(p[1]); num=pint(p[3])
        if num is None: continue
        drugs={}
        for k,dn in enumerate(drugs_cols):
            v=p[4+k] if 4+k<len(p) else ""
            s=pct(v)
            if s is None: continue
            drugs[norm_drug(dn)]={"S":int(s),"n":int(num)}
        if drugs:
            out.append((("ALL","ALL","ALL"),org,int(num),drugs))
    return out

def main():
    years={}
    # 2018
    wb=openpyxl.load_workbook(f"{YEARS_DIR}/2018.xlsx", data_only=True)
    years["2018"]=parse_old(wb[wb.sheetnames[0]], 2018)
    # 2019
    years["2019"]=parse_2019(f"{YEARS_DIR}/2019_overall.md")
    # 2020-2025 multi-sheet
    for y in ["2020","2021","2022","2023","2024","2025"]:
        wb=openpyxl.load_workbook(f"{YEARS_DIR}/{y}.xlsx", data_only=True)
        recs=[]
        for sn in wb.sheetnames:
            base=sheet_base(sn)
            if base is None: continue
            recs += parse_sheet(wb[sn], base)
        years[y]=recs

    # merge
    DATA={"organisms":{}}
    strata_seen=set(); origins=set(); specs=set(); wards=set(); drugset=set()
    for y,recs in years.items():
        for strat,org,N,drugs in recs:
            if N < MIN_N: continue
            key="|".join(strat)
            strata_seen.add(key); origins.add(strat[0]); specs.add(strat[1]); wards.add(strat[2])
            O=DATA["organisms"].setdefault(org,{"strata":{}})
            S=O["strata"].setdefault(key,{"N":{},"drugs":{}})
            S["N"][y]=N
            for dn,sv in drugs.items():
                drugset.add(dn)
                S["drugs"].setdefault(dn,{})[y]=sv
    # attach intrinsic-resistance list per organism (drugs that are always "R"; never shown with a %S)
    for org,O in DATA["organisms"].items():
        tested=set(O["strata"] and sum(([d for d in s["drugs"]] for s in O["strata"].values()),[]) or [])
        intr=sorted(d for d in INTR.get(org,()) if d not in tested)
        if intr: O["intrinsicR"]=intr
    SPEC_LABEL={"ALL":"ทุกสิ่งส่งตรวจ","Blood":"เลือด (Hemoculture)","Sputum":"เสมหะ (Sputum)","Urine":"ปัสสาวะ (Urine)"}
    WARD_LABEL={"ALL":"ทุก ward","MICU":"ICU อายุรกรรม (MICU)","SICU":"ICU ศัลยกรรม (SICU)"}
    DATA["meta"]={
        "years":sorted({y for y in years}),
        "origins":["ALL"]+[o for o in ["CAI","HAI"] if o in origins],
        "specimens":[{"key":s,"label":SPEC_LABEL[s]} for s in ["ALL","Blood","Sputum","Urine"] if s=="ALL" or s in specs],
        "wards":[{"key":w,"label":WARD_LABEL[w]} for w in ["ALL","MICU","SICU"] if w=="ALL" or w in wards],
        "drugs":sorted(drugset),
    }
    json.dump(DATA, open(f"{YEARS_DIR}/../DATA.json","w"), ensure_ascii=False)
    # --- diagnostics ---
    print("years parsed:", {y:len(r) for y,r in years.items()})
    print("strata:", sorted(strata_seen))
    print("meta:", DATA["meta"]["years"], DATA["meta"]["origins"], DATA["meta"]["specimens"], DATA["meta"]["wards"])
    print("n organisms:", len(DATA["organisms"]))
    ec=DATA["organisms"].get("Escherichia coli",{}).get("strata",{}).get("ALL|ALL|ALL")
    if ec:
        print("E.coli ALL|ALL|ALL N by year:", ec["N"])
        for d in ["Meropenem","Ampicillin","Ciprofloxacin","Amikacin"]:
            if d in ec["drugs"]:
                print(f"  {d}:", {y:v["S"] for y,v in sorted(ec["drugs"][d].items())})
    print("drugs:", DATA["meta"]["drugs"])

if __name__=="__main__":
    main()
