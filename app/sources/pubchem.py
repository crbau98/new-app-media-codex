from __future__ import annotations
import requests

PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"

def lookup_compound(session: requests.Session, name: str, timeout: int = 15) -> dict:
    """Fetch compound metadata from PubChem by name."""
    try:
        r = session.get(f"{PUBCHEM_BASE}/compound/name/{name}/cids/JSON", timeout=timeout)
        r.raise_for_status()
        cid = str(r.json()["IdentifierList"]["CID"][0])
    except Exception:
        return {}
    try:
        props = "IUPACName,MolecularWeight,PharmacologyAndBiochemistry"
        pr = session.get(f"{PUBCHEM_BASE}/compound/cid/{cid}/property/{props}/JSON", timeout=timeout)
        pr.raise_for_status()
        prop_data = pr.json()["PropertyTable"]["Properties"][0]
    except Exception:
        prop_data = {}
    return {
        "cid": cid,
        "iupac": prop_data.get("IUPACName", ""),
        "molecular_weight": prop_data.get("MolecularWeight"),
        "pharmacology": prop_data.get("PharmacologyAndBiochemistry", "")[:1000],
    }
