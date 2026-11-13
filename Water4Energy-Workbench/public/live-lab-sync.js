/* Coalesced, scoped reads for conversation figures. No execution requests. */
(function(global){
  'use strict';
  const RASTER=/\.(?:png|jpe?g|gif|webp)$/i;
  function safePath(value){
    return typeof value==='string' && value.length>0 && value.length<=1024 && !value.startsWith('/') &&
      !/[\\\u0000-\u001f\u007f%?#:]/.test(value) && value.split('/').every(part=>part && part!=='.' && part!=='..');
  }
  function displayedFigures(files,outputs,project){
    if(!Array.isArray(files)||!Array.isArray(outputs)||typeof project!=='string'||!project)return [];
    const existing=new Set(outputs.filter(file=>safePath(file?.name)).map(file=>file.name));
    const latest=new Map();
    for(const file of files){
      const name=file?.path||file?.name;
      if(file?.kind!=='outputs' || (file.status && file.status!=='current') || !safePath(name) || !RASTER.test(name) || !existing.has(name))continue;
      let url;
      try{url='/api/vista/projects/'+encodeURIComponent(project)+'/outputs/'+name.split('/').map(encodeURIComponent).join('/');}catch{continue;}
      const item={name,url:url+'?preview=true',downloadUrl:url};
      const shownAt=typeof file.shown_at==='string' && file.shown_at.length<=64 && Number.isFinite(Date.parse(file.shown_at))?new Date(file.shown_at).toISOString():null;
      if(shownAt)item.shownAt=shownAt;
      if(shownAt && [file.run_id,file.tool_call_id].every(value=>typeof value==='string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value)))item.displayId=file.run_id+'/'+file.tool_call_id+'/'+shownAt;
      const previous=latest.get(name);
      // The backend normally returns newest first. Retain the newest current
      // display even if a response is reordered, and keep legacy ties stable.
      if(!previous || (shownAt && (!previous.shownAt || shownAt>previous.shownAt)))latest.set(name,item);
    }
    // The guide follows the final item, so chronological order matters when
    // several display_file calls arrive in one coalesced refresh.
    return Array.from(latest.values()).sort((a,b)=>(Date.parse(a.shownAt)||0)-(Date.parse(b.shownAt)||0));
  }
  function createRefresher({read,apply,isCurrent=()=>true,onError=()=>{}}){
    let generation=0,pending=null,running=null;
    function request(context){
      pending={context,generation};
      if(!running){
        // Start after assigning running, including when the first scope is
        // already stale and the loop has no asynchronous read to await.
        running=Promise.resolve().then(async()=>{
          let last=null;
          try{
            while(pending){
              const task=pending;pending=null;
              if(task.generation!==generation || !isCurrent(task.context))continue;
              try{
                const result=await read(task.context);
                if(task.generation===generation && isCurrent(task.context)){apply(result,task.context);last=result;}
              }catch(error){if(task.generation===generation && isCurrent(task.context))onError(error,task.context);}
            }
            return last;
          }finally{running=null;}
        });
      }
      return running;
    }
    function invalidate(){generation++;pending=null;}
    return {request,invalidate};
  }
  const api={safePath,displayedFigures,createRefresher};
  global.TVALiveLabSync=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
