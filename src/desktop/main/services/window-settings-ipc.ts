import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import {
  WINDOW_RESOLUTION_PRESETS,
  WINDOW_SETTINGS_IPC_CHANNELS,
  parseWindowResolution,
  type WindowResolution,
  type WindowResolutionSettings
} from '../../contracts/ipc/window-settings'
import { WindowSettingsRepository } from './window-settings-repository'

const WINDOW_FRAME_ALLOWANCE = 72

function cloneResolution(resolution: WindowResolution): WindowResolution {
  return { width: resolution.width, height: resolution.height }
}

function getAvailableResolutions(
  mainWindow: BrowserWindow
): readonly WindowResolution[] {
  const display = screen.getDisplayMatching(mainWindow.getBounds())
  const maxWidth = display.workAreaSize.width
  const maxHeight = Math.max(0, display.workAreaSize.height - WINDOW_FRAME_ALLOWANCE)
  return WINDOW_RESOLUTION_PRESETS.filter(
    (resolution) => resolution.width <= maxWidth && resolution.height <= maxHeight
  ).map(cloneResolution)
}

function getFallbackResolution(
  availableResolutions: readonly WindowResolution[]
): WindowResolution {
  const fallback = availableResolutions.at(-1) ?? WINDOW_RESOLUTION_PRESETS[0]
  return cloneResolution(fallback)
}

function isAvailableResolution(
  resolution: WindowResolution,
  availableResolutions: readonly WindowResolution[]
): boolean {
  return availableResolutions.some(
    (candidate) =>
      candidate.width === resolution.width && candidate.height === resolution.height
  )
}

function assertMainWindow(event: IpcMainInvokeEvent, mainWindow: BrowserWindow): void {
  if (event.sender !== mainWindow.webContents) {
    throw new Error('Window settings requests must come from the main game window')
  }
}

/** Owns display-safe preset selection and serializes it through the main process. */
export class WindowSettingsService {
  private selectedResolution: WindowResolution

  private constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly repository: WindowSettingsRepository,
    selectedResolution: WindowResolution
  ) {
    this.selectedResolution = cloneResolution(selectedResolution)
  }

  static async create(
    mainWindow: BrowserWindow,
    repository: WindowSettingsRepository
  ): Promise<WindowSettingsService> {
    const availableResolutions = getAvailableResolutions(mainWindow)
    const savedResolution = await repository.getResolution()
    const selectedResolution =
      savedResolution && isAvailableResolution(savedResolution, availableResolutions)
        ? savedResolution
        : getFallbackResolution(availableResolutions)

    mainWindow.setContentSize(selectedResolution.width, selectedResolution.height)
    return new WindowSettingsService(mainWindow, repository, selectedResolution)
  }

  getSettings(): WindowResolutionSettings {
    const availableResolutions = getAvailableResolutions(this.mainWindow)
    const selectedResolution = isAvailableResolution(
      this.selectedResolution,
      availableResolutions
    )
      ? this.selectedResolution
      : getFallbackResolution(availableResolutions)

    return {
      selectedResolution: cloneResolution(selectedResolution),
      availableResolutions: availableResolutions.map(cloneResolution)
    }
  }

  async setResolution(resolution: WindowResolution): Promise<WindowResolutionSettings> {
    const requestedResolution = parseWindowResolution(resolution)
    const availableResolutions = getAvailableResolutions(this.mainWindow)
    if (!isAvailableResolution(requestedResolution, availableResolutions)) {
      throw new Error('That resolution does not fit on the current display')
    }

    this.mainWindow.setContentSize(
      requestedResolution.width,
      requestedResolution.height
    )
    this.selectedResolution = cloneResolution(requestedResolution)
    await this.repository.setResolution(requestedResolution)
    return this.getSettings()
  }
}

/** Registers the narrow, runtime-validated native window API. */
export function registerWindowSettingsIpc(
  mainWindow: BrowserWindow,
  service: WindowSettingsService
): void {
  ipcMain.removeHandler(WINDOW_SETTINGS_IPC_CHANNELS.get)
  ipcMain.removeHandler(WINDOW_SETTINGS_IPC_CHANNELS.setResolution)
  ipcMain.handle(WINDOW_SETTINGS_IPC_CHANNELS.get, (event) => {
    assertMainWindow(event, mainWindow)
    return service.getSettings()
  })
  ipcMain.handle(
    WINDOW_SETTINGS_IPC_CHANNELS.setResolution,
    async (event, resolution) => {
      assertMainWindow(event, mainWindow)
      return service.setResolution(parseWindowResolution(resolution))
    }
  )
}
