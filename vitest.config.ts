import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts', 'src/main/monitor/parse*.ts', 'src/main/ssh/sshConfig.ts', 'src/main/store/knownHostsLogic.ts', 'src/main/dataBatcher.ts'],
      exclude: ['**/*.test.ts', 'src/shared/types.ts']
    }
  }
})
