"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUp, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, FilePlus2, FileText, FlaskConical, FolderOpen, Layers3, LoaderCircle, LogOut, MessageSquareText, Plus, Search, ShieldCheck, Sparkles, Trash2, Upload, X } from "lucide-react";
import { parseDocument } from "@/lib/parse-document";

type Document = { id: string; title: string; version: string; filename: string; byteSize: number; pageCount: number; chunkCount: number; createdAt: string };
type Source = { id: number; documentId: string; title: string; filename: string; version: string; page: number; section: string; text: string; score: number };
type Answer = { mode: "sources" | "ai" | "insufficient"; answer: string; sources: Source[]; metrics: { retrievalMs: number; generationMs: number; totalMs: number; chunksSearched: number }; warning?: string };
type Exchange = { id: number; question: string; response: Answer };
type Evaluation = { total: number; passed: number; recallAt3: number; cases: { question: string; expected: string; retrieved: string[]; passed: boolean }[] };
type UploadItem = { key: string; file: File; title: string; version: string; status: "pending" | "reading" | "saving" | "done" | "error"; error?: string };
type Tab = "ask" | "library" | "evaluation";

const samples = [
  { title: "Find the right answer", question: "What authentication does Atlas use?", version: "all", icon: Search },
  { title: "Understand the details", question: "What is the request rate limit?", version: "v2.0", icon: BookOpen },
  { title: "Explore a change", question: "What is the upgrade checklist?", version: "v2.0", icon: Layers3 },
];

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error("The workspace couldn’t complete that request. Please try again."); }
  if (!response.ok) {
    const error = data as { error?: unknown };
    throw new Error(typeof error.error === "string" ? error.error : "Something went wrong. Please try again.");
  }
  return data as T;
}

function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function formatVersion(version: string) { return version; }
function message(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
function Logo({ small = false }: { small?: boolean }) {
  return <span className={`folio-logo ${small ? "small" : ""}`} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M8 5h17v5H13v6h10v5H13v8H8V5Z" fill="currentColor"/><path d="M25 5v5h-5l5-5Z" fill="#B8D1BF"/></svg></span>;
}

function CitedAnswer({ answer, sources, onCitation }: { answer: string; sources: Source[]; onCitation: (source: Source) => void }) {
  return <div className="answer-copy">{answer.split(/\n\s*\n/).filter(Boolean).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph.split(/(\[\d+\])/g).map((part, index) => {
    const match = /^\[(\d+)\]$/.exec(part);
    const source = match ? sources.find((item) => item.id === Number(match[1])) : undefined;
    return source ? <button key={index} className="citation" onClick={() => onCitation(source)} aria-label={`View source ${source.id}: ${source.title}`}>{source.id}</button> : <span key={index}>{part}</span>;
  })}</p>)}</div>;
}

export default function DocumentAssistant({ displayName }: { displayName: string }) {
  const [tab, setTab] = useState<Tab>("ask");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [status, setStatus] = useState<{ generationConfigured: boolean; model: string | null } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [documentSearch, setDocumentSearch] = useState("");
  const [version, setVersion] = useState("all");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [activeExchangeId, setActiveExchangeId] = useState<number | null>(null);
  const [activeSource, setActiveSource] = useState<number | null>(null);
  const [expandedSources, setExpandedSources] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [demoBusy, setDemoBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadDialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  const activeIds = useMemo(() => selectedIds === null ? documents.map((document) => document.id) : selectedIds.filter((id) => documents.some((document) => document.id === id)), [selectedIds, documents]);
  const versions = useMemo(() => [...new Set(documents.filter((document) => activeIds.includes(document.id)).map((document) => document.version))].sort(), [documents, activeIds]);
  const activeExchange = exchanges.find((exchange) => exchange.id === activeExchangeId) || exchanges.at(-1);
  const sources = activeExchange?.response.sources || [];
  const visibleDocuments = documents.filter((document) => `${document.title} ${document.filename} ${document.version}`.toLowerCase().includes(documentSearch.toLowerCase()));
  const firstName = displayName?.trim().split(/\s+/)[0] || "Researcher";

  useEffect(() => {
    let mounted = true;
    Promise.allSettled([request<{ documents: Document[] }>("/api/documents"), request<{ generationConfigured: boolean; model: string | null }>("/api/status")]).then(([docsResult, statusResult]) => {
      if (!mounted) return;
      if (docsResult.status === "fulfilled") setDocuments(docsResult.value.documents);
      else setError(message(docsResult.reason));
      if (statusResult.status === "fulfilled") setStatus(statusResult.value);
      else setError(message(statusResult.reason));
      setLoadingDocuments(false);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (uploadOpen) {
      const timer = setTimeout(() => uploadDialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus(), 10);
      return () => clearTimeout(timer);
    }
  }, [uploadOpen]);

  async function refreshDocuments() {
    const result = await request<{ documents: Document[] }>("/api/documents");
    setDocuments(result.documents);
    return result.documents;
  }

  function selectDocuments(ids: string[] | null) {
    setSelectedIds(ids);
    setVersion("all");
  }

  async function loadDemo() {
    if (demoBusy || busyRef.current) return;
    busyRef.current = true;
    setDemoBusy(true); setError("");
    try {
      await request("/api/demo", { method: "POST" });
      await refreshDocuments();
      selectDocuments(null);
      setNotice("The Atlas sample collection is ready. Try one of the suggested questions.");
    } catch (error) { setError(message(error)); }
    finally { setDemoBusy(false); busyRef.current = false; }
  }

  async function ask() {
    if (!question.trim() || asking || !activeIds.length || busyRef.current) return;
    const submittedQuestion = question.trim();
    if (submittedQuestion.length > 1500) { setError("Keep your question under 1,500 characters."); return; }
    busyRef.current = true;
    setAsking(true); setError("");
    try {
      const response = await request<Answer>("/api/ask", { method: "POST", body: JSON.stringify({ question: submittedQuestion, documentIds: activeIds, ...(version !== "all" ? { version } : {}) }) });
      const id = Date.now();
      setExchanges((current) => [...current, { id, question: submittedQuestion, response }]);
      setActiveExchangeId(id); setActiveSource(response.sources[0]?.id ?? null); setQuestion("");
      setTimeout(() => scrollEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
    } catch (error) { setError(message(error)); }
    finally { setAsking(false); busyRef.current = false; }
  }

  function selectCitation(exchange: Exchange, source: Source) {
    setActiveExchangeId(exchange.id); setActiveSource(source.id);
    setTimeout(() => document.getElementById(`source-${source.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 30);
  }

  async function removeDocument(id: string) {
    if (deletingId || busyRef.current) return;
    busyRef.current = true;
    setDeletingId(id); setError("");
    try {
      await request(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
      setDocuments((current) => current.filter((document) => document.id !== id));
      setSelectedIds((current) => current?.filter((selected) => selected !== id) ?? null);
      setVersion("all");
      setConfirmDeleteId(null); setNotice("Document removed from your library.");
    } catch (error) { setError(message(error)); }
    finally { setDeletingId(null); busyRef.current = false; }
  }

  function addFiles(files: FileList | File[]) {
    setUploadError("");
    const incoming = [...files];
    if (incoming.length + uploadItems.length > 10) { setUploadError("Add up to 10 files at a time."); return; }
    const invalid = incoming.find((file) => !/\.(pdf|txt|md)$/i.test(file.name) || file.size > 5_000_000);
    if (invalid) { setUploadError(`${invalid.name}: choose a PDF, Markdown, or text file up to 5 MB.`); return; }
    setUploadItems((current) => {
      const keys = new Set(current.map((item) => item.key));
      return [...current, ...incoming.filter((file) => !keys.has(`${file.name}-${file.size}-${file.lastModified}`)).map((file): UploadItem => ({ key: `${file.name}-${file.size}-${file.lastModified}`, file, title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "), version: "1.0", status: "pending" }))];
    });
  }

  async function importFiles() {
    if (uploadBusy || busyRef.current) return;
    const pending = uploadItems.filter((item) => item.status !== "done");
    if (!pending.length) return;
    if (pending.some((item) => !item.title.trim() || !item.version.trim())) { setUploadError("Give each document a title and version before importing."); return; }
    setUploadBusy(true); setUploadError(""); busyRef.current = true;
    let succeeded = 0;
    let failed = 0;
    const update = (key: string, patch: Partial<UploadItem>) => setUploadItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
    for (const item of pending) {
      try {
        update(item.key, { status: "reading", error: undefined });
        const parsed = await parseDocument(item.file);
        update(item.key, { status: "saving" });
        await request("/api/documents", { method: "POST", body: JSON.stringify({ filename: item.file.name, title: item.title.trim(), version: item.version.trim(), byteSize: item.file.size, pages: parsed.pages }) });
        update(item.key, { status: "done" }); succeeded++;
      } catch (error) { update(item.key, { status: "error", error: message(error) }); failed++; }
    }
    try { await refreshDocuments(); } catch (error) { setError(message(error)); }
    if (succeeded) { selectDocuments(null); setNotice(`${succeeded} ${succeeded === 1 ? "document" : "documents"} added to your library.`); }
    if (!failed) { setUploadOpen(false); setUploadItems([]); }
    setUploadBusy(false); busyRef.current = false;
  }

  async function runEvaluation() {
    if (evaluating || busyRef.current) return;
    busyRef.current = true; setEvaluating(true); setError("");
    try { setEvaluation(await request<Evaluation>("/api/evaluate", { method: "POST" })); }
    catch (error) { setError(message(error)); }
    finally { setEvaluating(false); busyRef.current = false; }
  }

  function newSession() { setExchanges([]); setActiveExchangeId(null); setActiveSource(null); setError(""); setTab("ask"); questionRef.current?.focus(); }

  return <div className="folio-app">
    <header className="app-header">
      <Link href="/" className="brand" aria-label="Folio home"><Logo /><span>folio<span className="brand-dot">.</span></span></Link>
      <div className="workspace-label"><span className="workspace-divider"/><span>Personal workspace</span></div>
      <nav className="main-nav" aria-label="Workspace navigation">
        <button className={tab === "ask" ? "active" : ""} onClick={() => setTab("ask")}><MessageSquareText size={16}/>Ask</button>
        <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><FolderOpen size={16}/>Library</button>
        <button className={tab === "evaluation" ? "active" : ""} onClick={() => setTab("evaluation")}><FlaskConical size={16}/>Evaluation</button>
      </nav>
      <div className="profile"><span className="private-label"><ShieldCheck size={14}/>Your private workspace</span><span className="avatar" title={displayName}>{firstName.slice(0, 1).toUpperCase()}</span><a href="/signout-with-chatgpt?return_to=/" className="icon-button signout" aria-label="Sign out" title="Sign out"><LogOut size={16}/></a></div>
    </header>

    <div className="app-body">
      <aside className={`document-sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-heading"><span className="eyebrow">YOUR COLLECTION</span><button className="icon-button" aria-label="Add documents" title="Add documents" onClick={() => { setUploadOpen(true); setSidebarOpen(false); }}><Plus size={18}/></button></div>
        <button className="upload-button" onClick={() => { setUploadOpen(true); setSidebarOpen(false); }}><Plus size={17}/>Add documents</button>
        <div className="sidebar-search"><Search size={15}/><input aria-label="Find a document" placeholder="Find a document…" value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)}/></div>
        <label className="collection-all"><input type="checkbox" checked={documents.length > 0 && activeIds.length === documents.length} disabled={!documents.length} onChange={() => selectDocuments(activeIds.length === documents.length ? [] : null)}/><span>All documents</span><span className="count-badge">{documents.length}</span></label>
        <div className="sidebar-documents">
          {loadingDocuments ? <div className="sidebar-loading"><LoaderCircle className="spin" size={17}/>Opening your library…</div> : visibleDocuments.length ? visibleDocuments.map((document) => <label className={`sidebar-document ${activeIds.includes(document.id) ? "selected" : ""}`} key={document.id}>
            <input type="checkbox" checked={activeIds.includes(document.id)} onChange={() => selectDocuments(activeIds.includes(document.id) ? activeIds.filter((id) => id !== document.id) : [...activeIds, document.id])}/><span className="document-icon"><FileText size={17}/></span><span className="sidebar-document-copy"><strong>{document.title}</strong><span>{document.filename.toLowerCase().endsWith(".pdf") ? "PDF" : document.filename.toLowerCase().endsWith(".md") ? "Markdown" : "Text"}<span className="tiny-dot"/>{formatVersion(document.version)}</span></span>
          </label>) : <div className="sidebar-empty"><div className="empty-folder"><FolderOpen size={28} strokeWidth={1.3}/></div><p>{documents.length ? "No matching documents" : "Room for your next idea."}</p><span>{documents.length ? "Try a different search." : "Add your notes, guides, and PDFs to start connecting the dots."}</span></div>}
        </div>
        <div className="sidebar-bottom">
          <div className="sample-box"><span className="sample-icon"><Sparkles size={17}/></span><strong>A good place to start</strong><p>Explore Folio with our sample API documentation.</p><button onClick={loadDemo} disabled={demoBusy || uploadBusy}>{demoBusy ? <LoaderCircle size={14} className="spin"/> : <ArrowUpRight size={14}/>} {demoBusy ? "Loading collection…" : "Load sample collection"}</button></div>
          <div className="sidebar-foot"><span className="status-dot"/><span>{documents.length} {documents.length === 1 ? "document" : "documents"} in your library</span></div>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close document collection" onClick={() => setSidebarOpen(false)}/>}

      <main className="workspace-main">
        <div className="mobile-collection"><button onClick={() => setSidebarOpen(!sidebarOpen)}><FolderOpen size={16}/>Documents <span>{documents.length}</span><ChevronDown size={14}/></button></div>
        {error && <div className="notice error" role="alert"><CircleHelp size={17}/><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}><X size={16}/></button></div>}
        {notice && <div className="notice success" role="status"><Check size={17}/><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={16}/></button></div>}

        {tab === "ask" && <div className="ask-layout">
          <section className="conversation-panel" aria-label="Document questions">
            <div className="conversation-toolbar"><div className="breadcrumb">Workspace <ChevronRight size={12}/><span>Ask your documents</span></div><button className="text-button" onClick={newSession} disabled={!exchanges.length}><Plus size={14}/>New question</button></div>
            <div className={`conversation-content ${exchanges.length ? "has-answers" : ""}`}>
              {!exchanges.length ? <div className="welcome">
                <div className="welcome-eyebrow"><span className="short-line"/>A LITTLE CLARITY GOES A LONG WAY</div>
                <h1>Good questions.<br/><em>Grounded answers.</em></h1>
                <p className="welcome-copy">Make sense of what you know. Ask your documents a question, and follow every answer back to its source.</p>
                <div className="welcome-rule"/><div className="suggestion-heading"><span>START WITH A QUESTION</span><span>01 — 03</span></div>
                <div className="suggestion-list">{samples.map((sample, index) => <button key={sample.title} className="suggestion" onClick={() => { setQuestion(sample.question); setVersion(sample.version === "all" || !versions.includes(sample.version) ? "all" : sample.version); questionRef.current?.focus(); }}><span className="suggestion-icon"><sample.icon size={18} strokeWidth={1.5}/></span><span><small>{sample.title}</small><strong>{sample.question}</strong></span><ArrowUpRight size={16}/><span className="suggestion-number">0{index + 1}</span></button>)}</div>
                {!documents.length && <p className="sample-caption">New here? <button onClick={loadDemo} disabled={demoBusy}>{demoBusy ? "Loading…" : "Try these with the sample collection"}<ArrowRight size={12}/></button></p>}
              </div> : <div className="exchanges">{exchanges.map((exchange) => <article className="exchange" key={exchange.id}>
                <div className="question-row"><span className="question-avatar">{firstName.slice(0, 1).toUpperCase()}</span><p>{exchange.question}</p></div>
                <div className="response"><div className="response-heading"><Logo small/><strong>{exchange.response.mode === "ai" ? "From your documents" : exchange.response.mode === "sources" ? "Relevant passages" : "A little more context needed"}</strong><span className="response-tag">{exchange.response.mode === "ai" ? "Cited answer" : exchange.response.mode === "sources" ? "Source search" : "Insufficient evidence"}</span></div>
                  <CitedAnswer answer={exchange.response.answer} sources={exchange.response.sources} onCitation={(source) => selectCitation(exchange, source)}/>
                  {exchange.response.warning && <p className="answer-warning"><CircleHelp size={14}/>{exchange.response.warning}</p>}
                  {exchange.response.sources.length > 0 && <button className="view-sources" onClick={() => { setActiveExchangeId(exchange.id); setActiveSource(exchange.response.sources[0].id); document.getElementById("evidence-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }}><CheckCheck size={15}/>{exchange.response.sources.length} supporting {exchange.response.sources.length === 1 ? "passage" : "passages"}<ArrowUpRight size={13}/></button>}
                  <details className="answer-metrics"><summary><Clock3 size={12}/>Response details<ChevronDown size={12}/></summary><div><span>Search <strong>{exchange.response.metrics.retrievalMs} ms</strong></span><span>Generation <strong>{exchange.response.metrics.generationMs} ms</strong></span><span>Total <strong>{exchange.response.metrics.totalMs} ms</strong></span><span>Passages searched <strong>{exchange.response.metrics.chunksSearched}</strong></span></div></details>
                </div>
              </article>)}<div ref={scrollEndRef}/></div>}
              {asking && <div className="thinking" role="status"><span className="thinking-icon"><Logo small/></span><span>Finding the useful details<span className="thinking-dots">…</span></span><LoaderCircle size={15} className="spin"/></div>}
            </div>
            <div className="composer-area">
              {status && !status.generationConfigured && <div className="source-mode"><span className="status-dot"/><span>Source search mode — configure an AI API key on the server to enable generated answers.</span></div>}
              <form className="question-composer" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
                <label className="sr-only" htmlFor="question">Ask your documents a question</label><textarea ref={questionRef} id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={documents.length ? "What would you like to understand?" : "Add documents, then ask anything about them…"} maxLength={1500} rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(); } }}/>
                <div className="composer-bottom"><div className="composer-scope"><span className="scope-icon"><Layers3 size={13}/></span><span>{activeIds.length === documents.length ? "All documents" : `${activeIds.length} selected`}</span><span className="scope-divider"/><label className="sr-only" htmlFor="version-filter">Document version</label><select id="version-filter" value={version} onChange={(event) => setVersion(event.target.value)}><option value="all">All versions</option>{versions.map((value) => <option key={value} value={value}>{formatVersion(value)}</option>)}</select></div><button className="send-button" type="submit" disabled={!question.trim() || asking || !activeIds.length || loadingDocuments} aria-label={asking ? "Searching documents" : "Ask question"}>{asking ? <LoaderCircle className="spin" size={18}/> : <ArrowUp size={19}/>}</button></div>
              </form>
              <div className="composer-foot"><span><ShieldCheck size={12}/>Answers you can trace. Sources you can check.</span><span>Enter to ask <span className="enter-symbol">↵</span></span></div>
              {documents.length > 0 && !activeIds.length && <p className="selection-warning">Select at least one document in your collection to ask a question.</p>}
            </div>
          </section>
          <aside className="evidence-panel" id="evidence-panel" aria-label="Supporting sources"><div className="evidence-heading"><div><BookOpen size={16}/><h2>Source notes</h2></div><span className="count-badge">{sources.length.toString().padStart(2, "0")}</span></div>
            {sources.length ? <><p className="evidence-intro">The passages behind your answer. Select a citation to take a closer look.</p><div className="source-list">{sources.map((source) => { const key = `${activeExchange?.id}-${source.id}`; const expanded = expandedSources.includes(key); return <article id={`source-${source.id}`} key={key} className={`source-card ${activeSource === source.id ? "is-active" : ""}`}><button className="source-card-header" onClick={() => setActiveSource(source.id)}><span className="source-number">{source.id}</span><span><strong>{source.title}</strong><small>{formatVersion(source.version)}<span className="tiny-dot"/>Page {source.page}</small></span>{activeSource === source.id && <span className="source-selected-dot"/>}</button>{source.section && <p className="source-section">{source.section}</p>}<blockquote className={expanded ? "expanded" : ""}>{source.text}</blockquote><button className="source-expand" onClick={() => setExpandedSources((current) => expanded ? current.filter((value) => value !== key) : [...current, key])}>{expanded ? "Show less" : "Read full passage"}<ChevronDown size={12} className={expanded ? "rotate" : ""}/></button></article>; })}</div><div className="source-note"><ShieldCheck size={14}/><p>Always check the original document before relying on an answer.</p></div></> : <div className="evidence-empty"><div className="paper-illustration" aria-hidden="true"><div className="paper-back"/><div className="paper-front"><span className="paper-tab"/><div className="paper-lines"><i/><i/><i/><i/></div><span className="paper-citation">1</span></div><span className="paper-spark">✦</span></div><h3>A source for<br/>every insight.</h3><p>Relevant passages will appear here, with the document, version, and page to keep you grounded.</p><div className="evidence-empty-label"><span/>NO GUESSWORK REQUIRED</div></div>}
            <div className="evidence-footer"><span className="footer-flower">✳</span><p>Less searching.<br/><strong>More understanding.</strong></p></div>
          </aside>
        </div>}

        {tab === "library" && <section className="page-section library-page"><div className="page-eyebrow">YOUR KNOWLEDGE, TOGETHER</div><div className="page-heading"><div><h1>A home for your documents.</h1><p>Bring your notes, guides, and reference material into the conversation.</p></div><button className="primary-button" onClick={() => setUploadOpen(true)}><Plus size={16}/>Add documents</button></div><div className="library-summary"><span><FolderOpen size={19}/><strong>{documents.length}</strong> documents</span><span><FileText size={18}/><strong>{documents.reduce((count, document) => count + document.pageCount, 0)}</strong> pages</span><span><Layers3 size={18}/><strong>{new Set(documents.map((document) => document.version)).size}</strong> versions</span></div>
          {documents.length ? <div className="library-table-wrap"><table className="library-table"><thead><tr><th>DOCUMENT</th><th>VERSION</th><th>DETAILS</th><th>ADDED</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{documents.map((document) => <tr key={document.id}><td><div className="library-document"><span className="library-file-icon"><FileText size={20} strokeWidth={1.5}/></span><div><strong>{document.title}</strong><small>{document.filename}</small></div></div></td><td><span className="version-pill">{formatVersion(document.version)}</span></td><td><span>{document.pageCount} {document.pageCount === 1 ? "page" : "pages"}</span><small>{formatBytes(document.byteSize)}</small></td><td>{new Date(document.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td><td>{confirmDeleteId === document.id ? <div className="delete-confirm"><span>Remove?</span><button disabled={Boolean(deletingId)} onClick={() => removeDocument(document.id)}>{deletingId === document.id ? "Removing…" : "Yes"}</button><button onClick={() => setConfirmDeleteId(null)} disabled={Boolean(deletingId)}>Cancel</button></div> : <button className="icon-button delete-button" aria-label={`Remove ${document.title}`} onClick={() => setConfirmDeleteId(document.id)}><Trash2 size={16}/></button>}</td></tr>)}</tbody></table></div> : <div className="library-empty"><span className="large-file-icon"><FilePlus2 size={34} strokeWidth={1.2}/></span><h2>Great answers start here.</h2><p>Add your first document, or explore a ready-to-use sample collection.</p><div><button className="primary-button" onClick={() => setUploadOpen(true)}><Upload size={15}/>Upload documents</button><button className="secondary-button" onClick={loadDemo} disabled={demoBusy}>{demoBusy ? <LoaderCircle size={15} className="spin"/> : <Sparkles size={15}/>}Load sample collection</button></div><small>PDF, Markdown, or text · Up to 5 MB per file</small></div>}
          <div className="library-tip"><CircleHelp size={17}/><div><strong>A little organization goes a long way.</strong><p>Give related documents the same title and different versions to keep your collection easy to navigate.</p></div></div>
        </section>}

        {tab === "evaluation" && <section className="page-section evaluation-page"><div className="page-eyebrow">A CLOSER LOOK AT QUALITY</div><div className="page-heading"><div><h1>Trust, with a little evidence.</h1><p>Check how reliably Folio finds the right passages for a known set of questions.</p></div><button className="primary-button" disabled={evaluating || demoBusy} onClick={runEvaluation}>{evaluating ? <LoaderCircle size={16} className="spin"/> : <FlaskConical size={16}/>} {evaluating ? "Running checks…" : "Run evaluation"}</button></div><div className="evaluation-explainer"><span className="evaluation-illustration"><FlaskConical size={27} strokeWidth={1.3}/></span><div><h2>A small test. A clearer picture.</h2><p>Run a fixed benchmark of 10 labeled cases against isolated sample documents: nine source lookups and one question with no supporting evidence. These small checks measure retrieval behavior, not generated-answer accuracy or the quality of your uploaded collection.</p><span className="benchmark-note">Fixed sample benchmark · 10 labeled cases · No AI scoring</span></div></div>
          {evaluation ? <><div className="evaluation-stats"><div><span>CHECKS PASSED</span><strong>{evaluation.passed}<small> / {evaluation.total}</small></strong><p>Expected sources found</p></div><div><span>RECALL AT 3</span><strong>{Math.round(evaluation.recallAt3 * 100)}<small>%</small></strong><p>Expected-source recall among the top 3</p></div><div className="evaluation-stat-note"><ShieldCheck size={25} strokeWidth={1.3}/><p>Measured on fixed sample documents.<br/><strong>A starting point for testing quality.</strong></p></div></div><div className="evaluation-results"><div className="results-heading"><h2>Question by question</h2><span>{evaluation.total} checks</span></div>{evaluation.cases.map((test, index) => <details className="evaluation-case" key={index}><summary><span className={`test-status ${test.passed ? "passed" : "failed"}`}>{test.passed ? <Check size={14}/> : <X size={14}/>}</span><span>{test.question}</span><span className={`test-label ${test.passed ? "passed" : "failed"}`}>{test.passed ? "Passed" : "Missed"}</span><ChevronDown size={15}/></summary><div className="test-detail"><strong>Expected evidence</strong><p>{test.expected}</p><strong>Retrieved evidence</strong>{test.retrieved.length ? <ul>{test.retrieved.map((result, index) => <li key={index}>{result}</li>)}</ul> : <p>No matching passages were retrieved.</p>}</div></details>)}</div></> : <div className="evaluation-placeholder"><div className="evaluation-grid" aria-hidden="true"><span/><span/><span/><span/><span/><span/></div><h2>Let the results speak.</h2><p>Run an evaluation to see pass rates and inspect the evidence behind each check.</p><span className="eyebrow">NO RESULTS YET</span></div>}
        </section>}
      </main>
    </div>

    {uploadOpen && <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !uploadBusy) setUploadOpen(false); }}><div className="upload-modal" ref={uploadDialogRef} role="dialog" aria-modal="true" aria-labelledby="upload-title" onKeyDown={(event) => { if (event.key === "Escape" && !uploadBusy) setUploadOpen(false); if (event.key === "Tab") { const focusable = uploadDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'); if (!focusable?.length) return; const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }}><div className="modal-heading"><div><span className="page-eyebrow">BUILD YOUR COLLECTION</span><h2 id="upload-title">A little knowledge to work with.</h2></div><button className="icon-button" disabled={uploadBusy} aria-label="Close upload dialog" onClick={() => setUploadOpen(false)}><X size={20}/></button></div><p className="modal-intro">Add documents to search, understand, and reference. You can label each version before importing.</p><input ref={fileInputRef} type="file" accept=".pdf,.txt,.md" multiple hidden onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }}/><button className={`dropzone ${dragging ? "dragging" : ""}`} disabled={uploadBusy} onClick={() => fileInputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); if (!uploadBusy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!uploadBusy) addFiles(event.dataTransfer.files); }}><span><Upload size={24} strokeWidth={1.5}/></span><strong>Drop your documents here</strong><p>or <u>browse files</u></p><small>PDF, Markdown, text · 5 MB / file · 100 PDF pages · Up to 10 files</small></button>{uploadError && <div className="upload-error" role="alert"><CircleHelp size={15}/>{uploadError}</div>}<div className="upload-file-list">{uploadItems.map((item) => <div className={`upload-file ${item.status}`} key={item.key}><div className="upload-file-heading"><FileText size={17}/><span>{item.file.name}</span><small>{formatBytes(item.file.size)}</small>{item.status === "done" ? <Check size={17}/> : item.status === "reading" || item.status === "saving" ? <LoaderCircle className="spin" size={17}/> : <button className="icon-button" aria-label={`Remove ${item.file.name} from upload`} disabled={uploadBusy} onClick={() => setUploadItems((current) => current.filter((file) => file.key !== item.key))}><X size={15}/></button>}</div><div className="upload-file-fields"><label>Document title<input value={item.title} maxLength={120} disabled={uploadBusy || item.status === "done"} onChange={(event) => setUploadItems((current) => current.map((file) => file.key === item.key ? { ...file, title: event.target.value } : file))}/></label><label>Version<input value={item.version} maxLength={40} placeholder="e.g. 2.0" disabled={uploadBusy || item.status === "done"} onChange={(event) => setUploadItems((current) => current.map((file) => file.key === item.key ? { ...file, version: event.target.value } : file))}/></label></div>{item.error && <p className="file-error" role="alert">{item.error}</p>}{item.status === "reading" || item.status === "saving" || item.status === "done" ? <p className="file-progress">{item.status === "reading" ? "Reading document…" : item.status === "saving" ? "Adding to your library…" : "Added to your library"}</p> : null}</div>)}</div><div className="upload-info"><ShieldCheck size={15}/><span>Text is extracted in your browser and saved to your private workspace. Scanned PDFs need OCR before uploading.</span></div><div className="modal-footer"><button className="secondary-button" disabled={uploadBusy} onClick={() => setUploadOpen(false)}>Cancel</button><button className="primary-button" disabled={uploadBusy || !uploadItems.some((item) => item.status !== "done")} onClick={importFiles}>{uploadBusy ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>} {uploadBusy ? "Importing documents…" : `Import ${uploadItems.filter((item) => item.status !== "done").length || ""} ${uploadItems.filter((item) => item.status !== "done").length === 1 ? "document" : "documents"}`}</button></div></div></div>}
  </div>;
}
