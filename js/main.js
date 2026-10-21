'use strict';

/* ================= start ================= */
buildParams(PARAMS, $('#paramList'));
buildParams(NONIDEAL, $('#nonIdealList'));
syncAllParams();
buildChannels();
buildTimeControls();
buildSchem();
buildControlUI();
if (new URLSearchParams(location.search).get('page') === 'control') setPage('control', true);
updateSegs();
updateNonIdealUI();
compute();
resize();
renderAll();
if (/selftest/.test(location.search)) selfTest();
