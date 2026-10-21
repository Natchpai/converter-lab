'use strict';

/* ================= start ================= */
buildParams(PARAMS, $('#paramList'));
buildParams(NONIDEAL, $('#nonIdealList'));
syncAllParams();
buildChannels();
buildTimeControls();
buildSchem();
updateSegs();
updateNonIdealUI();
compute();
resize();
renderAll();
if (/selftest/.test(location.search)) selfTest();
