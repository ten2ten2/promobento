// Original CC0 geometry. This deliberately keeps the same DOM/SVG/canvas nodes.
const ns='http://www.w3.org/2000/svg';
function svgElement(tag,attributes,parent) {
  const node=document.createElementNS(ns,tag);
  for (const [name,value] of Object.entries(attributes)) node.setAttribute(name,value);
  parent?.append(node);
  return node;
}

export default {
  apiVersion:'2.7.0',editables:[],markers:[],regions:[],videoUses:[],fonts:[],
  prepare({surface,width,height,randomAt}) {
    const background=document.createElement('div');
    Object.assign(background.style,{position:'absolute',inset:'0',background:'#f5f1e8'});
    surface.root.append(background);
    const tile=document.createElement('div');
    Object.assign(tile.style,{position:'absolute',left:'170px',top:'220px',width:'740px',height:'300px',
      borderRadius:'48px',background:'#f2783d',transformOrigin:'center'});
    surface.root.append(tile);
    const canvas=surface.createCanvas();
    Object.assign(canvas.style,{position:'absolute',inset:'0'});
    const context=canvas.getContext('2d');
    if (!context) throw new Error('CANVAS_2D_UNAVAILABLE');
    const particles=Array.from({length:24},(_,index)=>({x:80+randomAt('x'+index)*(width-160),
      y:height*0.48+randomAt('y'+index)*height*0.3,phase:randomAt('phase'+index)*Math.PI*2}));
    const svg=svgElement('svg',{width,height,viewBox:`0 0 ${width} ${height}`},surface.root);
    Object.assign(svg.style,{position:'absolute',inset:'0'});
    const group=svgElement('g',{},svg);
    svgElement('rect',{x:150,y:height*0.58,width:width-300,height:240,rx:40,fill:'#24352b'},group);
    svgElement('path',{d:`M260 ${height*0.58+160}L400 ${height*0.58+60}L540 ${height*0.58+160}L680 ${height*0.58+60}L820 ${height*0.58+160}`,
      fill:'none',stroke:'#f8dc80','stroke-width':18,'stroke-linejoin':'round'},group);
    for (const [index,fill] of ['#ff0000','#00ff00','#0000ff','#808080'].entries())
      svgElement('rect',{x:40+index*38,y:height-60,width:24,height:24,fill},svg);
    return {
      draw({numerator,denominator}) {
        const time=numerator/denominator;
        tile.style.transform=`translateY(${(45*Math.sin(time*0.7)).toFixed(6)}px) rotate(${(4*Math.sin(time*0.3)).toFixed(6)}deg)`;
        tile.style.opacity=(0.7+0.3*Math.cos(time*0.9)**2).toFixed(6);
        group.setAttribute('transform',`translate(${(35*Math.sin(time*0.8)).toFixed(6)} ${(18*Math.cos(time*0.4)).toFixed(6)})`);
        group.setAttribute('opacity',(0.7+0.3*Math.sin(time*0.5)**2).toFixed(6));
        // Reset all Canvas state and pixels; never integrate from a previous frame.
        context.reset();
        context.fillStyle='#9bbba0';
        for (const particle of particles) {
          context.beginPath();
          context.arc(particle.x+22*Math.sin(time+particle.phase),particle.y+16*Math.cos(time*0.7+particle.phase),12,0,Math.PI*2);
          context.fill();
        }
        context.strokeStyle='#24352b';context.lineWidth=16;context.lineCap='round';
        context.beginPath();context.moveTo(190,660);
        context.lineTo(190+700*(0.5+0.5*Math.sin(time*0.25)),660);context.stroke();
        return {regions:[]};
      },
      dispose() { background.remove();tile.remove();canvas.remove();svg.remove(); }
    };
  }
};
