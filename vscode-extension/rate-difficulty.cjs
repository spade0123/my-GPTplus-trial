function rateDifficulty(rate){
  if(!Number.isFinite(rate)||rate<0||rate>100)return {level:0,label:'待统计'};
  const level=rate>=70?1:rate>=50?2:rate>=30?3:4;
  return {level,label:['待统计','基础','常规','进阶','较难'][level]};
}
module.exports={rateDifficulty};
