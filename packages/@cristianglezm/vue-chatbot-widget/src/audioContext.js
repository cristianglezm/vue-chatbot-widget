let audioContext = null;

/**
 * @brief One AudioContext for everything that has to decode audio.
 * Every message mounts an AudioPlayer, an AudioContext each (and none closed) piles up, and browsers only allow a few open.
 * It is created when something needs it, ie: on a click, browsers do not start it before a user gesture.
 * @returns {AudioContext} The shared AudioContext.
 */
export const getAudioContext = () => {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    return audioContext;
};
