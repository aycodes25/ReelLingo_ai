"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BookOpenText, ChevronDown, CircleAlert, Plus, Trash2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { addGlossaryTerm, deleteGlossaryTerm, getGlossary, getLanguages, updateGlossaryTerm } from "@/lib/api";
import type { GlossaryTerm, LanguageOption } from "@/lib/types";

const EMPTY = { term: "", translation: "", target_language: "", note: "" };

export default function GlossaryPage() {
  const [terms, setTerms] = useState<GlossaryTerm[] | null>(null);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [draft, setDraft] = useState(EMPTY);
  const [editing, setEditing] = useState<GlossaryTerm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getGlossary().then(setTerms).catch((loadError: unknown) => { setTerms([]); setError(loadError instanceof Error ? loadError.message : "Could not load."); });
    getLanguages().then((items) => setLanguages(items.filter((item) => item.code !== "auto"))).catch(() => undefined);
  }, []);

  async function run(task: () => Promise<GlossaryTerm[]>) {
    setBusy(true);
    setError(null);
    try {
      setTerms(await task());
      return true;
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (await run(() => addGlossaryTerm(draft))) setDraft(EMPTY);
  }

  const languageLabel = (code: string) => (code ? languages.find((language) => language.code === code)?.name || code : "All languages");

  return (
    <AppShell crumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Glossary" }]}>
      <div className="page-head">
        <div>
          <h1>Glossary</h1>
          <p>Names, brands and slang the translator must keep — or always translate a certain way. Terms also help transcription spell names correctly.</p>
        </div>
      </div>

      {error && <div role="alert" className="alert alert-error" style={{ marginBottom: 20 }}><CircleAlert size={16} /><span>{error}</span></div>}

      <form className="card card-pad glossary-form" onSubmit={handleAdd}>
        <div className="field">
          <label className="field-label" htmlFor="term">Word or name</label>
          <input id="term" className="input input-plain" required placeholder="e.g. Iya Basira, Ọ̀jà Ọba, Wahala" value={draft.term} onChange={(event) => setDraft({ ...draft, term: event.target.value })} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="translation">Always translate as <small>(leave empty to keep as-is)</small></label>
          <input id="translation" className="input input-plain" placeholder="Keep unchanged" value={draft.translation} onChange={(event) => setDraft({ ...draft, translation: event.target.value })} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="term-language">Applies to</label>
          <div className="select-wrap">
            <select id="term-language" className="select" value={draft.target_language} onChange={(event) => setDraft({ ...draft, target_language: event.target.value })}>
              <option value="">All target languages</option>
              {languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
            </select>
            <ChevronDown size={17} />
          </div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || !draft.term.trim()}><Plus size={16} />Add term</button>
      </form>

      {terms === null ? <div className="skeleton" style={{ height: 160, marginTop: 24 }} /> : terms.length ? (
        <div className="table-wrap" style={{ marginTop: 24 }}>
          <table className="data-table">
            <thead><tr><th>Term</th><th>Rule</th><th>Applies to</th><th /></tr></thead>
            <tbody>
              {terms.map((term) => editing?.id === term.id ? (
                <tr key={term.id}>
                  <td><input className="input input-plain" value={editing.term} onChange={(event) => setEditing({ ...editing, term: event.target.value })} aria-label="Term" /></td>
                  <td><input className="input input-plain" value={editing.translation} placeholder="Keep unchanged" onChange={(event) => setEditing({ ...editing, translation: event.target.value })} aria-label="Translation" /></td>
                  <td>
                    <div className="select-wrap select-sm">
                      <select className="select" value={editing.target_language} onChange={(event) => setEditing({ ...editing, target_language: event.target.value })} aria-label="Applies to">
                        <option value="">All</option>
                        {languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
                      </select>
                      <ChevronDown size={14} />
                    </div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { if (await run(() => updateGlossaryTerm(editing))) setEditing(null); }}>Save</button>{" "}
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={term.id}>
                  <td><b>{term.term}</b></td>
                  <td>{term.translation ? <>Always → <b>{term.translation}</b></> : "Keep exactly as written"}</td>
                  <td>{languageLabel(term.target_language)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(term)}>Edit</button>{" "}
                    <button type="button" className="icon-btn" aria-label={`Delete ${term.term}`} disabled={busy} onClick={() => run(() => deleteGlossaryTerm(term.id))}><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state" style={{ marginTop: 24 }}>
          <span><BookOpenText size={24} /></span>
          <strong>No glossary terms yet</strong>
          Add the names of people, places and brands in your videos so they&apos;re never mistranslated.
        </div>
      )}
    </AppShell>
  );
}
