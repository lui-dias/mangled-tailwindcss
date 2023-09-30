const postcss = require('postcss')
const tailwind = require('./lib/index')
const fs = require('fs')

const css = fs.readFileSync('./project/styles.css', 'utf-8')
postcss([
    tailwind
]).process(
    css, { from: './project/styles.css', to: './project/out.css'}
).then(result => {
    fs.writeFileSync('./project/out.css', result.css, 'utf-8')
})