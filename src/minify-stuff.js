const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'

function mini() {
	const n = [0]

	return () => {
		let s = ''

		for (const i of n) {
			s += letters[i]
		}

		const last = n[n.length - 1]

		if (last < letters.length - 1) {
			n[n.length - 1] = last + 1
		} else {
			n.push(0)
		}

		return s
	}
}

module.exports = {
    mini
}