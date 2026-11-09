'use strict';
var MANAGER = 'luna://com.webos.applicationManager/';
var BROADCAST = 'luna://com.webos.service.tv.broadcast/';
var AUDIO = 'luna://com.webos.service.tv.sound/getDTVAudioRunningState';
function cleanup(call, later, finish) {
  function foreground(next) {
    call(MANAGER + 'getForegroundAppInfo', {}, function (error, result) {
      if (error || !result || result.returnValue !== true) return finish('foreground_unverified');
      if (result.appId !== 'tld.my.customlauncher') return finish('skipped_other_foreground', {appId: result.appId});
      next();
    });
  }
  function inspectPipeline(mediaId) {
    call(BROADCAST + 'getPipeline4BootUp', {}, function (error, result) {
      if (error || !result || result.returnValue !== true || typeof result.broadcastId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.broadcastId)) return finish('boot_pipeline_unverified');
      var payload = {broadcastId: result.broadcastId};
      function valid(reply) { return reply && reply.returnValue === true && reply.broadcastId === payload.broadcastId; }
      call(BROADCAST + 'getBroadcastState', payload, function (error, state) {
        if (error || !valid(state) || typeof state.state !== 'string') return finish('broadcast_state_unverified');
        if (state.state === 'BROADCAST_STATE_UNREALIZED') return finish('no_background_tv_audio');
        call(AUDIO, payload, function (error, audio) {
          if (error || !valid(audio) || typeof audio.bIsRunningAudio !== 'boolean') return finish('broadcast_audio_unverified');
          if (!audio.bIsRunningAudio) return finish('no_background_tv_audio');
          foreground(function () {
            call('luna://com.webos.media/getActivePipelines', {}, function (error, pipelines) {
              if (error || !Array.isArray(pipelines)) return finish('media_ownership_unverified');
              var tv = pipelines.filter(function (pipeline) { return pipeline && pipeline.type === 'tv'; });
              if (tv.length !== 1 || tv[0].id !== mediaId || tv[0].currentAppId !== 'reserved' || tv[0].is_foreground !== true ||
                  !Array.isArray(tv[0].resource) || !tv[0].resource.some(function (r) { return r && r.resource === 'ADEC'; })) return finish('media_ownership_changed');
            call(BROADCAST + 'stop', payload, function (error, stopped) {
              if (error || !valid(stopped)) return finish('boot_tv_stop_refused');
              function verify(remaining) {
                call(BROADCAST + 'getBroadcastState', payload, function (error, state) {
                  if (error || !valid(state)) return finish('boot_tv_stop_unverified');
                  if (state.state === 'BROADCAST_STATE_UNREALIZED') return finish('boot_tv_stopped', payload);
                  if (!remaining) return finish('boot_tv_stop_unverified');
                  later(function () { verify(remaining - 1); }, 500);
                });
              }
              later(function () { verify(6); }, 500);
            });
            });
          });
        });
      });
    });
  }
  foreground(function () {
    call('luna://com.webos.media/getActivePipelines', {}, function (error, pipelines) {
      if (error || !Array.isArray(pipelines)) return finish('media_ownership_unverified');
      var tv = pipelines.filter(function (pipeline) { return pipeline && pipeline.type === 'tv'; });
      // Never interfere with a pipeline already handed to native LiveTV. Its
      // normal focus lifecycle must retain sole ownership of pause/resume.
      if (!tv.length) return finish('no_background_tv_audio');
      if (tv.length !== 1) return finish('media_ownership_ambiguous');
      if (tv[0].currentAppId !== 'reserved') return finish('no_background_tv_audio');
      if (typeof tv[0].id !== 'string' || !tv[0].id) return finish('media_ownership_unverified');
      if (tv[0].is_foreground !== true || !Array.isArray(tv[0].resource)) return finish('no_background_tv_audio');
      if (!tv[0].resource.some(function (resource) { return resource && resource.resource === 'ADEC'; })) return finish('no_background_tv_audio');
      inspectPipeline(tv[0].id);
    });
  });
}
module.exports.cleanup = cleanup;
