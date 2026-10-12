import { JsonFile } from './jsonFile'
import { checkHostKey, type HostKeyCheck, type KnownHostsMap } from './knownHostsLogic'

export class KnownHostsStore {
  private file: JsonFile<KnownHostsMap>

  constructor(path: string) {
    this.file = new JsonFile(path, () => ({}))
  }

  check(id: string, fingerprint: string): HostKeyCheck {
    return checkHostKey(this.file.read(), id, fingerprint)
  }

  remember(id: string, fingerprint: string, keyType: string): void {
    const map = this.file.read()
    this.file.write({ ...map, [id]: { fingerprint, keyType, addedAt: Date.now() } })
  }
}
