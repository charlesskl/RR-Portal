type Send=(path:string,init?:RequestInit)=>Promise<Response>;
export async function taskMutation(path:string,init:RequestInit|undefined,send:Send):Promise<Response>{
  let options=init;
  for(;;){
    const response=await send(path,options);
    if(!options?.method||options.method==="GET"||response.status!==409||(options.body!=null&&typeof options.body!=="string"))return response;
    const warning=await response.clone().json().catch(()=>({}));
    if(warning.code!=="OtherTaskOwner")return response;
    const body=options.body==null?{}:JSON.parse(options.body);
    const owners={...(body.ownerConfirmations||{})};
    if(owners[warning.taskId]===warning.ownerId||!window.confirm(warning.error))throw new Error("已取消保存，当前编辑内容保留");
    owners[warning.taskId]=warning.ownerId;
    const headers=new Headers(options.headers);headers.set("content-type","application/json");
    options={...options,headers,body:JSON.stringify({...body,ownerConfirmations:owners,confirmedOwnerId:warning.ownerId})};
  }
}
