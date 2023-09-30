const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'

function mini() {
  const n = [0]

  return (reverse) => {
    let s = ''

    
    while (true) {
        const last = n[n.length - 1]
      if (reverse) {
        if (last === 0) {
          n.pop()
        } else {
          n[n.length - 1] = last - 1
        }
        break
      } else {
        for (const i of n) {
          s += letters[i]
        }

        if (last < letters.length - 1) {
          n[n.length - 1] = last + 1
        } else {
          n.push(0)
        }

        if (/^[\d-]/.test(s)) {
          s = s.slice(0, -1)
          continue
        }

        break
      }
    }

    return s
  }
}

module.exports = {
  mini,
}
