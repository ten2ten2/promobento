// Original geometry and bitmap lettering; CC0 dedication in LICENSE.txt.
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

export default {
  apiVersion:'2.7.0',editables:[],markers:[],regions:[],videoUses:[],fonts:[],
  prepare({width,height,randomAt}) {
    return {
      draw({numerator,denominator}) {
        const t=numerator/denominator,commands=[];
        const rect=(x,y,w,h,color,radius=0,opacity=1)=>commands.push({op:'rect',x,y,width:w,height:h,color,radius:Math.min(radius,w/2,h/2),opacity});
        const circle=(x,y,radius,color,opacity=1)=>commands.push({op:'circle',x,y,radius,color,opacity});
        const label=(text,y,size,color)=>{
          const x=(width-(text.length*6-1)*size)/2;
          [...text].forEach((character,i)=>{
            if(character===' ')return;
            for(const [yy,row] of glyphs[character].entries())
              for(const run of row.matchAll(/1+/g))rect(x+(i*6+run.index)*size,y+yy*size,run[0].length*size,size,color);
          });
        };
        rect(0,0,width,height,'#f5f1e8');
        for(let i=0;i<18;i++)circle(50+randomAt('x'+i)*(width-100),100+randomAt('y'+i)*(height-200),3,'#d8d0c3');
        label('PROMOBENTO',130,9,'#24352b');
        label('SOURCE TO SCREEN',310,8,'#24352b');
        const bob=12*Math.sin(t*Math.PI/3);
        rect(100,490+bob,width-200,820,'#24352b',48);
        rect(132,522+bob,370,360,'#f2783d',28);
        commands.push({op:'polygon',points:[{x:255,y:610+bob},{x:255,y:790+bob},{x:390,y:700+bob}],color:'#fff8eb',opacity:1});
        rect(526,522+bob,422,172,'#f8dc80',28);
        for(let i=0;i<4;i++)rect(560+i*84,560+bob,50,80,'#24352b',12,0.35+0.65*(1+Math.sin(t+i))/2);
        rect(526,718+bob,422,164,'#9bbba0',28);
        circle(602,800+bob,38,'#24352b');rect(672,768+bob,200,18,'#24352b',9);rect(672,814+bob,138,18,'#24352b',9);
        rect(132,906+bob,816,372,'#fff8eb',28);
        for(let i=0;i<11;i++) {
          const h=55+170*(1+Math.sin(t/2+i*0.5))/2;
          rect(168+i*68,1225+bob-h,42,h,i%3===0?'#f2783d':'#9bbba0',12);
        }
        label('FRAME BY FRAME',1430,8,'#24352b');
        label('SAFE SOURCE',1560,6,'#526052');
        rect(100,height-170,width-200,8,'#d8d0c3',4);
        rect(100,height-170,(width-200)*Math.min(1,t/30),8,'#f2783d',4);
        return {commands,regions:[]};
      },
      dispose() {}
    };
  }
};
