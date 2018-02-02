let pi;
let log = console.log; // eslint-disable-line no-unused-vars
let localStorage;

module.exports = {
    init: init,
    onCall: onProcCall,
    onUISetSettings: onUISetSettings,
};


/**
 * Initialize plugin
 * @param {object} pluginInterface The interface of picogw plugin
 */
function init(pluginInterface) {
    pi = pluginInterface;
    log = pi.log;
    localStorage = pi.localStorage;
};

/**
 * Setting value rewriting event for UI
 * @param {object} newSettings Settings edited for UI
 * @return {object} Settings to save
 */
function onUISetSettings(newSettings) {
    return newSettings;
}

/**
 * onCall handler of plugin
 * @param {string} method Caller method, accept GET only.
 * @param {string} path Plugin URL path
 * @param {object} args parameters of this call
 * @return {object} Returns a Promise object or object containing the result
 */
function onProcCall(method, path, args) {
    log('Call:'+JSON.stringify(arguments));
    const pathSplit = path.split('/');
    const devid = pathSplit.shift();
    const propname = pathSplit.join('/');
    switch (method) {
    case 'GET':
        return onProcCallGet(method, devid, propname, args);
    }
    return {error: `The specified method ${method} is not implemented in this plugin.`};
}

// eslint-disable-next-line require-jsdoc
function onProcCallGet(method, serviceid, propname, args) {
    return new Promise((ac, rj)=>{
        // const keys = localStorage.getKeys();
        if (serviceid === '') {
            ac({});
        } else {
            ac({});
        }
    });
}
