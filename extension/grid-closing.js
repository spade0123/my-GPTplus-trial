// Run in the page MAIN world, where the site's own problemlist is available.
// Return only closeTime; never copy the surrounding course/account object.
export function readGridClosingTime(expectedUrl){
  try{
    const expected=new URL(expectedUrl);
    if(expected.origin!=='https://programming.pku.edu.cn'||location.origin!==expected.origin||location.pathname!==expected.pathname)return null;
    if(typeof problemlist==='undefined'||!problemlist)return null;
    function primitive(value){
      if(typeof value==='number')return Number.isFinite(value)?value:null;
      if(typeof value==='string')return value.length<=100?value:null;
      if(value instanceof Date){const timestamp=Date.prototype.getTime.call(value);return Number.isFinite(timestamp)?timestamp:null;}
      return null;
    }
    // The site initializes closeTime with text_to_date(assignment.closeTime).
    return primitive(problemlist.closeTime)??primitive(problemlist.assignment?.closeTime);
  }catch{return null;}
}
