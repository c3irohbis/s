/* Public-chat masking only. Static, synchronous, no network or persistence. */
(function () {
  'use strict';
  const BAD_WORDS = [
    'حمار', 'غبي', 'حيوان', 'زباله', 'وسخ', 'واطي', 'قذر', 'خول',
    'عرص', 'معرص', 'متناك', 'شرموطه', 'ابن الكلب', 'ابن الوسخه',
    'ابن الحرام', 'يا كلب', '7mar', 'ghaby', 'zebala', 'khawal',
    '3ars', 'wes5', 'fuck', 'shit', 'bitch'
  ];
  const norm = s => s.normalize('NFKC').toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640\p{Cf}]/gu, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/(.)\1+/gu, '$1');
  const words = new Set(), phrases = [];
  BAD_WORDS.forEach(w => { const n=norm(w); if(n.includes(' '))phrases.push(n.split(' '));else words.add(n); });
  phrases.sort((a,b)=>b.length-a.length);
  function forbidden(w) { return words.has(w)||words.has(w.replace(/^(?:ال|[وبلكف])/,'')); }
  function mask(value) {
    const text=String(value??''); if(!text)return text;
    const raw=[];
    for(const m of text.matchAll(/[\p{L}\p{N}\p{M}\p{Cf}ـ]+/gu)){
      const n=norm(m[0]);if(n)raw.push({n,start:m.index,end:m.index+m[0].length});
    }
    const tokens=[];
    for(let i=0;i<raw.length;i++){
      let t={...raw[i]};
      if(t.n.length===1){
        while(i+1<raw.length&&raw[i+1].n.length===1&&/^[\s.ـ_\-،,]*$/u.test(text.slice(t.end,raw[i+1].start))){t.n+=raw[++i].n;t.end=raw[i].end;}
        t.n=norm(t.n);
      }
      tokens.push(t);
    }
    const spans=[];
    for(let i=0;i<tokens.length;i++){
      let count=0;
      for(const p of phrases){
        if(p.every((w,j)=>tokens[i+j]?.n===w&&(j===0||/^\s+$/u.test(text.slice(tokens[i+j-1].end,tokens[i+j].start))))){count=p.length;break;}
      }
      if(!count&&forbidden(tokens[i].n))count=1;
      if(count){spans.push([tokens[i].start,tokens[i+count-1].end]);i+=count-1;}
    }
    if(!spans.length)return text;
    let out='',last=0;for(const [a,b]of spans){out+=text.slice(last,a)+'**';last=b;}return out+text.slice(last);
  }
  function filename(value) {
    const s=String(value??''),m=/\.[a-z0-9]{1,12}$/i.exec(s);
    return m?mask(s.slice(0,m.index))+m[0]:mask(s);
  }
  // Change only text fields of the outgoing public payload, never identity or media URLs.
  function payload(data,chatId) {
    if(chatId!=='public'||!data)return data;
    if(typeof data.text==='string')data.text=mask(data.text);
    if(typeof data.fileName==='string')data.fileName=filename(data.fileName);
    if(data.reply){data.reply={...data.reply};if(typeof data.reply.text==='string')data.reply.text=mask(data.reply.text);if(typeof data.reply.fileName==='string')data.reply.fileName=filename(data.reply.fileName);}
    if(data.poll){data.poll={...data.poll,question:mask(data.poll.question),options:data.poll.options.map(mask)};}
    return data;
  }
  window.BariqProfanity=Object.freeze({mask,filename,payload,wordCount:BAD_WORDS.length,version:1});
})();
