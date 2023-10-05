import fs from 'fs'
import LRU from '@alloc/quick-lru'
import * as sharedState from './sharedState'
import { generateRules } from './generateRules'
import log from '../util/log'
import cloneNodes from '../util/cloneNodes'
import { defaultExtractor } from './defaultExtractor'
import { mini } from '../minify-stuff'
import { writeFileSync } from 'fs'
import escapeClassName from '../util/escapeClassName'

let env = sharedState.env

const builtInExtractors = {
  DEFAULT: defaultExtractor,
}

const builtInTransformers = {
  DEFAULT: (content) => content,
  svelte: (content) => content.replace(/(?:^|\s)class:/g, ' '),
}

function getExtractor(context, fileExtension) {
  let extractors = context.tailwindConfig.content.extract

  return (
    extractors[fileExtension] ||
    extractors.DEFAULT ||
    builtInExtractors[fileExtension] ||
    builtInExtractors.DEFAULT(context)
  )
}

function getTransformer(tailwindConfig, fileExtension) {
  let transformers = tailwindConfig.content.transform

  return (
    transformers[fileExtension] ||
    transformers.DEFAULT ||
    builtInTransformers[fileExtension] ||
    builtInTransformers.DEFAULT
  )
}

let extractorCache = new WeakMap()
const allClasses = []

// Scans template contents for possible classes. This is a hot path on initial build but
// not too important for subsequent builds. The faster the better though — if we can speed
// up these regexes by 50% that could cut initial build time by like 20%.
function getClassCandidates(content, extractor, candidates, seen) {
  if (!extractorCache.has(extractor)) {
    extractorCache.set(extractor, new LRU({ maxSize: 25000 }))
  }

  for (let line of content.split('\n')) {
    line = line.trim()

    if (seen.has(line)) {
      continue
    }
    seen.add(line)

    if (extractorCache.get(extractor).has(line)) {
      for (let match of extractorCache.get(extractor).get(line)) {
        candidates.add(match)
      }
    } else {
      let extractorMatches = extractor(line).filter((s) => s !== '!*')
      for (const i of extractorMatches) {
        allClasses.push(i)
      }

      let lineMatchesSet = new Set(extractorMatches)

      for (let match of lineMatchesSet) {
        candidates.add(match)
      }

      extractorCache.get(extractor).set(line, lineMatchesSet)
    }
  }
}

function countBy(asdasdasd) {
  return asdasdasd.reduce(function (count, currentValue) {
    return count[currentValue] ? ++count[currentValue] : (count[currentValue] = 1), count
  }, {})
}

/**
 *
 * @param {[import('./offsets.js').RuleOffset, import('postcss').Node][]} rules
 * @param {*} context
 */
function buildStylesheet(rules, context) {
  let sortedRules = context.offsets.sort(rules)

  let returnValue = {
    base: new Set(),
    defaults: new Set(),
    components: new Set(),
    utilities: new Set(),
    variants: new Set(),
  }

  const m = mini()
  let classesMap = {}
  const counted = countBy(allClasses)

  for (let [sort, rule] of sortedRules) {
    if (sort.layer === 'utilities' || sort.layer === 'variants') {
      classesMap[rule.raws.tailwind.candidate] = {
        tailwindClass: rule.raws.tailwind.candidate,
        cssSelector: rule.selector ?? rule.nodes[0].selector,
        classesCount: counted[rule.raws.tailwind.candidate],
      }
    }
  }

  classesMap = Object.fromEntries(
    Object.entries(classesMap)
      .sort((a, b) => a[1].classesCount - b[1].classesCount)
      .reverse()
  )

  for (let [k, v] of Object.entries(classesMap)) {
    const n = m()

    if (n.length >= v.tailwindClass.length) {
      m(true)
    }

    const lowerName = n.length < v.tailwindClass.length ? n : v.tailwindClass

    for (let [sort, rule] of sortedRules) {
      if (rule.type !== 'comment' && (rule.selector ?? rule.nodes[0].selector) === v.cssSelector) {
        rule.selector = '.' + escapeClassName(lowerName.replace(/^\./, ''))
        classesMap[k].minorName = escapeClassName(lowerName.replace(/^\./, ''))
        classesMap[k].mangledName = escapeClassName(n)
      }

      returnValue[sort.layer].add(rule)
    }
  }

  writeFileSync('classesMap.json', JSON.stringify(classesMap, null, 4))

  return returnValue
}

export default function expandTailwindAtRules(context) {
  return async (root) => {
    let layerNodes = {
      base: null,
      components: null,
      utilities: null,
      variants: null,
    }

    root.walkAtRules((rule) => {
      // Make sure this file contains Tailwind directives. If not, we can save
      // a lot of work and bail early. Also we don't have to register our touch
      // file as a dependency since the output of this CSS does not depend on
      // the source of any templates. Think Vue <style> blocks for example.
      if (rule.name === 'tailwind') {
        if (Object.keys(layerNodes).includes(rule.params)) {
          layerNodes[rule.params] = rule
        }
      }
    })

    if (Object.values(layerNodes).every((n) => n === null)) {
      return root
    }

    // ---

    // Find potential rules in changed files
    let candidates = new Set([...(context.candidates ?? []), sharedState.NOT_ON_DEMAND])
    let seen = new Set()

    env.DEBUG && console.time('Reading changed files')

    if (typeof __OXIDE__ !== 'undefined') {
      // TODO: Pass through or implement `extractor`
      for (let candidate of require('@tailwindcss/oxide').parseCandidateStringsFromFiles(
        context.changedContent
        // Object.assign({}, builtInTransformers, context.tailwindConfig.content.transform)
      )) {
        candidates.add(candidate)
      }

      // for (let { file, content, extension } of context.changedContent) {
      //   let transformer = getTransformer(context.tailwindConfig, extension)
      //   let extractor = getExtractor(context, extension)
      //   getClassCandidatesOxide(file, transformer(content), extractor, candidates, seen)
      // }
    } else {
      await Promise.all(
        context.changedContent.map(async ({ file, content, extension }) => {
          let transformer = getTransformer(context.tailwindConfig, extension)
          let extractor = getExtractor(context, extension)
          content = file ? await fs.promises.readFile(file, 'utf8') : content
          getClassCandidates(transformer(content), extractor, candidates, seen)
        })
      )
    }

    env.DEBUG && console.timeEnd('Reading changed files')
    console.log('Found', candidates.size, 'classes')

    // ---

    // Generate the actual CSS
    let classCacheCount = context.classCache.size

    env.DEBUG && console.time('Generate rules')
    env.DEBUG && console.time('Sorting candidates')
    let sortedCandidates =
      typeof __OXIDE__ !== 'undefined'
        ? candidates
        : new Set(
            [...candidates].sort((a, z) => {
              if (a === z) return 0
              if (a < z) return -1
              return 1
            })
          )
    env.DEBUG && console.timeEnd('Sorting candidates')
    generateRules(sortedCandidates, context)
    env.DEBUG && console.timeEnd('Generate rules')

    // We only ever add to the classCache, so if it didn't grow, there is nothing new.
    env.DEBUG && console.time('Build stylesheet')
    if (context.stylesheetCache === null || context.classCache.size !== classCacheCount) {
      context.stylesheetCache = buildStylesheet([...context.ruleCache], context)
    }
    env.DEBUG && console.timeEnd('Build stylesheet')

    let {
      defaults: defaultNodes,
      base: baseNodes,
      components: componentNodes,
      utilities: utilityNodes,
      variants: screenNodes,
    } = context.stylesheetCache

    // ---

    // Replace any Tailwind directives with generated CSS

    if (layerNodes.base) {
      layerNodes.base.before(
        cloneNodes([...baseNodes, ...defaultNodes], layerNodes.base.source, {
          layer: 'base',
        })
      )
      layerNodes.base.remove()
    }

    if (layerNodes.components) {
      layerNodes.components.before(
        cloneNodes([...componentNodes], layerNodes.components.source, {
          layer: 'components',
        })
      )
      layerNodes.components.remove()
    }

    if (layerNodes.utilities) {
      layerNodes.utilities.before(
        cloneNodes([...utilityNodes], layerNodes.utilities.source, {
          layer: 'utilities',
        })
      )
      layerNodes.utilities.remove()
    }

    // We do post-filtering to not alter the emitted order of the variants
    const variantNodes = Array.from(screenNodes).filter((node) => {
      const parentLayer = node.raws.tailwind?.parentLayer

      if (parentLayer === 'components') {
        return layerNodes.components !== null
      }

      if (parentLayer === 'utilities') {
        return layerNodes.utilities !== null
      }

      return true
    })

    if (layerNodes.variants) {
      layerNodes.variants.before(
        cloneNodes(variantNodes, layerNodes.variants.source, {
          layer: 'variants',
        })
      )
      layerNodes.variants.remove()
    } else if (variantNodes.length > 0) {
      root.append(
        cloneNodes(variantNodes, root.source, {
          layer: 'variants',
        })
      )
    }

    // If we've got a utility layer and no utilities are generated there's likely something wrong
    const hasUtilityVariants = variantNodes.some(
      (node) => node.raws.tailwind?.parentLayer === 'utilities'
    )

    if (layerNodes.utilities && utilityNodes.size === 0 && !hasUtilityVariants) {
      log.warn('content-problems', [
        'No utility classes were detected in your source files. If this is unexpected, double-check the `content` option in your Tailwind CSS configuration.',
        'https://tailwindcss.com/docs/content-configuration',
      ])
    }

    // ---

    if (env.DEBUG) {
      console.log('Potential classes: ', candidates.size)
      console.log('Active contexts: ', sharedState.contextSourcesMap.size)
    }

    // Clear the cache for the changed files
    context.changedContent = []

    // Cleanup any leftover @layer atrules
    root.walkAtRules('layer', (rule) => {
      if (Object.keys(layerNodes).includes(rule.params)) {
        rule.remove()
      }
    })
  }
}
