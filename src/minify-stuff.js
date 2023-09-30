const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'

function mini() {
  const n = [0]

  return (reverse) => {
    let s = ''

    const last = n[n.length - 1]

    while (true) {
      if (reverse) {
        if (last === 0) {
          n.pop()
        } else {
          n[n.length - 1] = last - 1
        }
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
