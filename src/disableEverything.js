// Plain JS side-effect suppression for Node entrypoints
// This file is intentionally minimal and must be importable by plain `node`.
(function(){
  try{
    // Silence console methods but keep stdout.write intact for canonical stream
    ['log','info','warn','error','debug'].forEach(function(k){ try{ console[k]=function(){} }catch(e){} });
  }catch(e){}
})();
