export type ViewMode = 'split' | 'editor' | 'preview'
export type Theme = 'light' | 'dark' | 'system'
export type ExportFormat = 'pdf' | 'docx' | 'png' | 'jpeg' | 'html'
export type ExportStyle = 'classic' | 'editorial' | 'minimal'

export interface DocumentState {
  id: string
  title: string
  path: string | null
  content: string
  savedContent: string
  mtimeMs: number | null
}

export interface Settings {
  theme: Theme
  fontSize: number
  autoSave: boolean
  syncScroll: boolean
  view: ViewMode
  sidebar: boolean
}

export interface SessionState {
  documents: DocumentState[]
  activeId: string
  settings: Settings
}

export interface RecentFile { path: string; title: string }
export interface Bootstrap extends Partial<SessionState> {
  recents: RecentFile[]
  version: string
  desktop: boolean
}

export interface ExportOptions {
  format: ExportFormat
  style: ExportStyle
  pageSize: 'A4' | 'Letter'
  landscape: boolean
  margin: number
  pageNumbers: boolean
  imageMode: 'long' | 'pages'
  scale: 1 | 2
  transparent: boolean
}

export interface ExportPayload {
  html: string
  markdown: string
  documentId: string
  title: string
  options: ExportOptions
  diagrams: string[]
}

export interface ExportResult { paths: string[] }
export type AppEvent =
  | { type: 'menu'; action: string }
  | { type: 'opened'; documents: DocumentState[] }
  | { type: 'external-change'; id: string; content: string; mtimeMs: number }
  | { type: 'close-request'; quit?: boolean }

export interface MoyeBridge {
  bootstrap(): Promise<Bootstrap>
  open(): Promise<DocumentState[]>
  openRecent(path: string): Promise<DocumentState[]>
  openDropped(files: File[]): Promise<DocumentState[]>
  save(doc: DocumentState, saveAs?: boolean): Promise<DocumentState | null>
  persist(state: SessionState): Promise<void>
  confirmClose(title: string): Promise<'save' | 'discard' | 'cancel'>
  closeWindow(quit?: boolean): Promise<void>
  importImage(documentId: string, data?: { bytes: number[]; name: string }): Promise<string | null>
  embedImage(src: string, documentId: string): Promise<string>
  export(payload: ExportPayload): Promise<ExportResult | null>
  reveal(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  onEvent(callback: (event: AppEvent) => void): () => void
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light', fontSize: 14, autoSave: false,
  syncScroll: true, view: 'split', sidebar: true
}

export const DEFAULT_EXPORT: ExportOptions = {
  format: 'pdf', style: 'classic', pageSize: 'A4', landscape: false,
  margin: 18, pageNumbers: true, imageMode: 'long', scale: 2, transparent: false
}
