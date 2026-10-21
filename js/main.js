'use strict';

/* ================= start ================= */
buildParams(PARAMS, $('#paramList'));
buildParams(NONIDEAL, $('#nonIdealList'));
syncAllParams();
buildChannels();
buildTimeControls();
buildSchem();
buildControlUI();
const query = new URLSearchParams(location.search);
if (query.get('mode') === 'pcmc') $('#ctlMode button[data-m="pcmc"]').click();
if (query.get('page') === 'control') setPage('control', true);
updateSegs();
updateNonIdealUI();
compute();
resize();
renderAll();
if (/selftest/.test(location.search)) selfTest();
else if (query.has('uitest')) uiTest();
