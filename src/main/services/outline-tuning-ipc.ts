import { ipcMain } from 'electron'
import {
  OUTLINE_TUNING_IPC_CHANNELS,
  parseOutlineTuningConfig
} from '../../shared/ipc/outline-tuning'
import { OutlineTuningRepository } from './outline-tuning-repository'

export function registerOutlineTuningIpc(repository: OutlineTuningRepository): void {
  ipcMain.handle(OUTLINE_TUNING_IPC_CHANNELS.save, async (_event, config: unknown) => {
    await repository.save(parseOutlineTuningConfig(config))
  })
}
