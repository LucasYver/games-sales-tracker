"""Lab UI, one page per step of the V2.

    ../ml/.venv/bin/streamlit run app.py
"""

import streamlit as st

from ui import anchor_page, bench_page, catalog_page, data_page, diagnosis_page, explain_page

st.set_page_config(page_title="Ventes · labo V2", layout="wide")

pages = [st.Page(explain_page.render, title="Comment ça marche", url_path="explication", default=True),
         st.Page(data_page.render, title="1 · Les données", url_path="donnees"),
         st.Page(bench_page.render, title="2 · Le banc", url_path="banc"),
         st.Page(diagnosis_page.render, title="3 · Comprendre les erreurs", url_path="erreurs"),
         st.Page(anchor_page.render, title="4 · L'ancrage", url_path="ancrage"),
         st.Page(catalog_page.render, title="5 · Le catalogue", url_path="catalogue")]
st.navigation(pages).run()
