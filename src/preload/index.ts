import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MoyeBridge, AppEvent } from '../shared/types'

const invoke = (name: string, ...args: unknown[]) => ipcRenderer.invoke(`moye:${name}`, ...args)
const bridge: MoyeBridge = {
  bootstrap: () => invoke('bootstrap'),
  open: () => invoke('open'),
  openRecent: path => invoke('open-recent', path),
  openDropped: files => invoke('open-dropped', files.map(file => webUtils.getPathForFile(file))),
  save: (doc, saveAs) => invoke('save', doc, saveAs),
  persist: state => invoke('persist', state),
  confirmClose: title => invoke('confirm-close', title),
  closeWindow: quit => invoke('close-window', quit),
  importImage: (id, data) => invoke('import-image', id, data),
  embedImage: (src, id) => invoke('embed-image', src, id),
  export: payload => invoke('export', payload),
  reveal: path => invoke('reveal', path),
  openExternal: url => invoke('open-external', url),
  onEvent: callback => {
    const listener = (_: unknown, event: AppEvent) => callback(event)
    ipcRenderer.on('moye:event', listener)
    return () => ipcRenderer.removeListener('moye:event', listener)
  }
}
contextBridge.exposeInMainWorld('moye', bridge)
