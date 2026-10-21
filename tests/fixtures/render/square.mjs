const clamp01 = value => Math.min(1, Math.max(0, value));
const easeOutCubic = value => 1 - (1 - clamp01(value)) ** 3;

// Original 5x7 geometric glyphs make the first fixture independent of system fonts.
const glyphs = {
  A:['01110','10001','10001','11111','10001','10001','10001'], B:['11110','10001','10001','11110','10001','10001','11110'],
  C:['01111','10000','10000','10000','10000','10000','01111'], D:['11110','10001','10001','10001','10001','10001','11110'],
  E:['11111','10000','10000','11110','10000','10000','11111'], F:['11111','10000','10000','11110','10000','10000','10000'],
  H:['10001','10001','10001','11111','10001','10001','10001'], I:['11111','00100','00100','00100','00100','00100','11111'],
  L:['10000','10000','10000','10000','10000','10000','11111'], M:['10001','11011','10101','10101','10001','10001','10001'],
  N:['10001','11001','10101','10011','10001','10001','10001'], O:['01110','10001','10001','10001','10001','10001','01110'],
  P:['11110','10001','10001','11110','10000','10000','10000'], R:['11110','10001','10001','11110','10100','10010','10001'],
  S:['01111','10000','10000','01110','00001','00001','11110'], T:['11111','00100','00100','00100','00100','00100','00100'],
  U:['10001','10001','10001','10001','10001','10001','01110'], V:['10001','10001','10001','10001','10001','01010','00100'],
  X:['10001','10001','01010','00100','01010','10001','10001'], Y:['10001','10001','01010','00100','00100','00100','00100'],
  '0':['01110','10001','10011','10101','11001','10001','01110'], '1':['00100','01100','00100','00100','00100','00100','01110'],
  '5':['11111','10000','10000','11110','00001','00001','11110']
};
const ns = 'http://www.w3.org/2000/svg';
function element(tag, attrs, parent) {
  const node = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  parent?.append(node);
  return node;
}
function label(parent, text, y, size, fill) {
  const width = (text.length * 6 - 1) * size, x = (1080 - width) / 2;
  let d = '';
  [...text].forEach((character, index) => {
    if (character === ' ') return;
    if (!glyphs[character]) throw new Error('FIXTURE_GLYPH_MISSING:' + character);
    glyphs[character].forEach((row, yy) => [...row].forEach((pixel, xx) => {
      if (pixel === '1') d += `M${x + (index * 6 + xx) * size},${y + yy * size}h${size}v${size}h-${size}z`;
    }));
  });
  return element('path', {d, fill}, parent);
}

export default {
  apiVersion: '2.7.0', editables: [], markers: [], regions: [], videoUses: [], fonts: [],
  prepare({surface, width, height, randomAt}) {
    if (width !== 1080 || height !== 1080) throw new Error('FIXTURE_REQUIRES_SQUARE');
    const svg = element('svg', {width, height, viewBox: '0 0 1080 1080'}, surface.root);
    element('rect', {width, height, fill:'#f5f1e8'}, svg);
    const specks = element('g', {fill:'#d8d0c3'}, svg);
    for (let i=0;i<24;i++) element('circle', {cx:80+randomAt('x'+i)*920, cy:80+randomAt('y'+i)*920, r:3}, specks);
    label(svg, 'PROMOBENTO', 95, 8, '#24352b');
    const title = label(svg, 'YOUR NEXT LAUNCH', 215, 9, '#24352b');
    const box = element('g', {}, svg);
    element('rect', {x:170,y:365,width:740,height:410,rx:48,fill:'#24352b'}, box);
    const cards = [
      element('g', {}, box), element('g', {}, box), element('g', {}, box)
    ];
    element('rect',{x:194,y:389,width:338,height:362,rx:30,fill:'#f2783d'},cards[0]);
    element('path',{d:'M305 485L445 570L305 655Z',fill:'#fff8eb'},cards[0]);
    element('rect',{x:556,y:389,width:330,height:168,rx:30,fill:'#f8dc80'},cards[1]);
    element('path',{d:'M604 503L659 448L714 503L769 448L832 503',fill:'none',stroke:'#24352b','stroke-width':18,'stroke-linejoin':'round'},cards[1]);
    element('rect',{x:556,y:581,width:330,height:170,rx:30,fill:'#9bbba0'},cards[2]);
    element('circle',{cx:645,cy:666,r:36,fill:'#24352b'},cards[2]);
    element('rect',{x:704,y:636,width:128,height:18,rx:9,fill:'#24352b'},cards[2]);
    element('rect',{x:704,y:676,width:90,height:18,rx:9,fill:'#24352b'},cards[2]);
    const cta = label(svg, 'PRESS PLAY', 845, 10, '#24352b');
    label(svg, '15 SECOND DEMO', 976, 4, '#526052');
    // Static sRGB reference swatches, measured after the MP4 color conversion.
    for (const [index,fill] of ['#ff0000','#00ff00','#0000ff','#808080'].entries())
      element('rect',{x:40+index*38,y:1020,width:24,height:24,fill},svg);
    return {
      draw({numerator, denominator}) {
        const seconds = numerator / denominator;
        title.setAttribute('opacity', clamp01(seconds / 0.7).toFixed(6));
        box.setAttribute('transform', `translate(0 ${(70*(1-easeOutCubic(seconds/1.3))).toFixed(6)})`);
        box.setAttribute('opacity', easeOutCubic(seconds/0.8).toFixed(6));
        cards.forEach((card,index) => {
          const pulse = 1 + 0.018 * Math.sin((seconds - index*0.7)*Math.PI/2);
          card.setAttribute('transform', `translate(540 570) scale(${pulse.toFixed(6)}) translate(-540 -570)`);
        });
        cta.setAttribute('opacity', (0.35+0.65*easeOutCubic((seconds-7)/2)).toFixed(6));
        return {regions:[]};
      },
      dispose() { svg.remove(); }
    };
  }
};
