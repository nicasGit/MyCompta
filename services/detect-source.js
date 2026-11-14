async function detectSource(buffer){
  const {PDFParse}=require('pdf-parse');
  const parser=new PDFParse({data:new Uint8Array(buffer)});
  try{
    const text=(await parser.getText({first:2})).text.normalize('NFD').replace(/[\u0300-\u036f\s]/g,'').toLowerCase();
    const matches=[];
    if(/postfinancesa|bicpofich/.test(text)&&/extraitdecompte/.test(text))matches.push('PostFinance');
    if(/ubsswitzerlandag|ubs\.com/.test(text)&&/nodecompte/.test(text)&&/relevedecompte/.test(text))matches.push('UBS');
    // Issuer account headers take precedence over card companies named as beneficiaries.
    if(!matches.length){
      if(/topcardservicesa|topcard\.ch/.test(text))matches.push('TopCard');
      if(/cembramoneybank|cembra\.ch|certomastercard/.test(text))matches.push('Cembra');
    }
    if(matches.length!==1)throw Object.assign(new Error(matches.length?'Plusieurs banques reconnues : choisissez l’établissement manuellement.':'Banque non reconnue : choisissez l’établissement manuellement.'),{status:422});
    return matches[0];
  }finally{await parser.destroy();}
}
module.exports={detectSource};
