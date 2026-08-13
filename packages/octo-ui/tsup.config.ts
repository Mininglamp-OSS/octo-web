import { readFileSync, writeFileSync } from 'node:fs'
import postcss from 'postcss'
import atImport from 'postcss-import'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['@douyinfe/semi-icons', '@douyinfe/semi-ui', 'react', 'react-dom'],
  async onSuccess() {
    const entryCss = 'src/styles/index.css'
    const raw = readFileSync(entryCss, 'utf8')
    const out = await postcss([atImport()]).process(raw, { from: entryCss })
    writeFileSync('dist/styles.css', out.css)
  },
})
