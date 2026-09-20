import test from 'node:test';
import assert from 'node:assert/strict';
import {productDescription} from '../lib/product-description';
test('product description keeps readable paragraph and list boundaries as plain text',()=>{
 assert.equal(productDescription('<h2>Özellikler</h2><p>Siyah &amp; beyaz.</p><ul><li>1.000 adet</li><li>&#214;lçü: 10&nbsp;cm</li></ul>'),'Özellikler\n\nSiyah & beyaz.\n\n• 1.000 adet\n\n• Ölçü: 10 cm');
 assert.equal(productDescription('<script>alert(1)</script><p>Güvenli</p><img src=x onerror=alert(1)>'),'Güvenli');
 assert.equal(productDescription(undefined,'Yalın açıklama'),'Yalın açıklama');
 assert.equal(productDescription('<ul><li>\n<p>Raf Ömrü: 18 ay</p>\n</li><li>\n<p>Net Ağırlık: 750 ml</p></li></ul>'),'• Raf Ömrü: 18 ay\n\n• Net Ağırlık: 750 ml');
});
