import { readFileSync, writeFileSync } from 'node:fs'
import postcss from 'postcss'
import atImport from 'postcss-import'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    input: 'src/components/Input/index.tsx',
    select: 'src/components/Select/index.tsx',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    '@douyinfe/semi-icons',
    '@douyinfe/semi-ui',
    'react',
    'react-dom',
    'react/jsx-runtime',
  ],
  async onSuccess() {
    const entryCss = 'src/styles/index.css'
    const raw = readFileSync(entryCss, 'utf8')
    const out = await postcss([atImport()]).process(raw, { from: entryCss })
    writeFileSync('dist/styles.css', out.css)
  },
})
