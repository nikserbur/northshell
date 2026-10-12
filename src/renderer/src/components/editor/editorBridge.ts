/** Lets global shortcuts (menu ⌘F / ⌘W) reach the open editor without prop drilling. */
interface EditorCommands {
  find(): void
  requestClose(): void
}

let current: EditorCommands | null = null

export const editorBridge = {
  register(commands: EditorCommands): () => void {
    current = commands
    return () => {
      if (current === commands) current = null
    }
  },
  find(): boolean {
    current?.find()
    return Boolean(current)
  },
  requestClose(): boolean {
    current?.requestClose()
    return Boolean(current)
  }
}
