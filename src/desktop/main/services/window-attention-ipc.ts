import { ipcMain, type BrowserWindow } from 'electron'
import {
  WINDOW_ATTENTION_CHANNEL,
  parseWindowHighlighted
} from '../../contracts/ipc/window-attention'

/** Native taskbar attention belongs to the game window, never the renderer. */
export function registerWindowAttentionIpc(mainWindow: BrowserWindow): void {
  const webContents = mainWindow.webContents
  const clearHighlight = (): void => {
    if (process.platform === 'win32' && !mainWindow.isDestroyed()) {
      mainWindow.flashFrame(false)
    }
  }

  ipcMain.handle(WINDOW_ATTENTION_CHANNEL, (event, value: unknown) => {
    if (event.sender !== webContents || event.senderFrame !== webContents.mainFrame) {
      throw new Error('Window attention requests must come from the main game window')
    }
    const highlighted = parseWindowHighlighted(value)
    if (process.platform === 'win32' && !mainWindow.isDestroyed()) {
      mainWindow.flashFrame(highlighted && !mainWindow.isFocused())
    }
  })

  mainWindow.on('focus', clearHighlight)
  webContents.on('render-process-gone', clearHighlight)
  webContents.on('did-start-loading', clearHighlight)
  mainWindow.once('closed', () => {
    ipcMain.removeHandler(WINDOW_ATTENTION_CHANNEL)
    mainWindow.removeListener('focus', clearHighlight)
    webContents.removeListener('render-process-gone', clearHighlight)
    webContents.removeListener('did-start-loading', clearHighlight)
  })
}
