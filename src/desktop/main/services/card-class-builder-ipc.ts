import { ipcMain } from 'electron'
import {
  CARD_CLASS_BUILDER_IPC_CHANNELS,
  parseCardClassBuilderConfig
} from '../../contracts/ipc/card-class-builder'
import { CardClassBuilderRepository } from './card-class-builder-repository'

export function registerCardClassBuilderIpc(
  repository: CardClassBuilderRepository
): void {
  ipcMain.handle(
    CARD_CLASS_BUILDER_IPC_CHANNELS.save,
    async (_event, config: unknown) => {
      await repository.save(parseCardClassBuilderConfig(config))
    }
  )
}
