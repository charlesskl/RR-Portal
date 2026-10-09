// Only these display fields may cross the collector/cloud boundary. Never copy raw printer objects.
export function deviceDetails(value={}) {
 const result={};
 for(const key of ['sourceMachine','name','gcodeFile','jobName','error'])if(typeof value[key]==='string')result[key]=value[key].slice(0,key==='sourceMachine'?32:256);
 for(const key of ['remainingTime','nozzleTemp','nozzleTarget','bedTemp','bedTarget','layerNum','totalLayers','currentHeight','laserPowerMw'])if(typeof value[key]==='number'&&Number.isFinite(value[key])&&value[key]>=0&&value[key]<=10000000)result[key]=value[key];
 return result;
}
