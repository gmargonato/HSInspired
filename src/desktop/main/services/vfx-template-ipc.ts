import { ipcMain } from 'electron'
import {
  parseVfxTemplateLibrary,
  VFX_TEMPLATES_IPC_CHANNELS
} from '../../contracts/ipc/vfx-templates'
import { VfxTemplateRepository } from './vfx-template-repository'

export function registerVfxTemplateIpc(repository: VfxTemplateRepository): void {
  ipcMain.handle(VFX_TEMPLATES_IPC_CHANNELS.save, async (_event, library: unknown) => {
    await repository.save(parseVfxTemplateLibrary(library))
  })
}
