// node credit.test.mjs
import assert from 'node:assert/strict'
import { artist } from './credit.mjs'

assert.equal(artist('No machine-readable author provided. Maccoinnich~commonswiki assumed (based on copyright claims).'), 'Maccoinnich')
assert.equal(artist('Photograph by Mike Peel .'), 'Mike Peel')
assert.equal(artist('<a href="x">mattbuck</a> (category)'), 'mattbuck')
assert.equal(artist(''), 'Wikimedia Commons')
assert.equal(artist('No machine-readable author provided.'), 'Wikimedia Commons')
assert.equal(artist('Flickr:Tim Green aka atouch'), 'Tim Green')
assert.equal(artist('Original uploader was Chowells at en.wikipedia'), 'Chowells')
assert.equal(artist('jan zeschky from glasgow, scotland'), 'jan zeschky')
assert.equal(artist('Ronnie Macdonald from Chelmsford, United Kingdom'), 'Ronnie Macdonald')
assert.equal(artist('Fahdshariff at English Wikipedia'), 'Fahdshariff')
assert.equal(artist('User NHSavage on en.wikipedia'), 'NHSavage')
console.log('credit: 11 passed')
