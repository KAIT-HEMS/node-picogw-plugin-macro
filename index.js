const vm = require('vm');

let pi;
let log = console.log; // eslint-disable-line no-unused-vars
let localStorage;
let modeSetHistory;
const MODE_SET_HISTORY_ENTRY_MAX = 100;


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

    modeSetHistory = localStorage.getItem('modeSetHistory', []);
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
    // log('Call:'+JSON.stringify(arguments));
    switch (method) {
    case 'GET': return onProcCallGet(path, args);
    case 'PUT': return onProcCallPut(path, args);
    }
    return {error: `The specified method ${method} is not implemented in this plugin.`};
}

function addModeSetHistoryEntry(newmode, result) {
    const id = (
        modeSetHistory.length==0
            ? 0
            : modeSetHistory[0].meta.id + 1);

    const curDate = new Date();
    modeSetHistory.unshift({
        created_at: curDate.toISOString(),
        mode: newmode,
        result: result,
        meta: {
            id: id,
            timestamp: Math.floor(curDate.getTime()/1000),
        },
    });

    modeSetHistory = modeSetHistory.slice(0, MODE_SET_HISTORY_ENTRY_MAX);
    localStorage.setItem('modeSetHistory', modeSetHistory);
};

function onProcCallGet(path, args) {
    if (path != 'mode' || args == null || args.type != 'history') {
        return {};
    }

    const mode_query = args.mode;

    let ret = modeSetHistory.filter((entry)=>{
        return entry.mode == mode_query;
    });

    return {data: ret.slice(0, args.limit||50)};
}

function onProcCallPut(path, args) {
    if (path != 'mode') {
        const errmsg = `${path} is not defined`;
        console.error(errmsg);
        return {errors: [{message: 'macro: '+errmsg}]};
    }

    const newmode = args.mode;
    const settings = pi.setting.getSettings();

    const code = settings.actions[newmode];
    if (code == null) {
        const errmsg = `mode "${newmode}" does not exist.`;
        console.error(errmsg);
        return {errors: [{message: 'macro: '+errmsg}]};
    }


    return new Promise((ac, rj)=>{
        const sandbox = {
            resolve: (re)=>{
                ac(re);
                addModeSetHistoryEntry(newmode, re);
            },
            reject: (e)=>{
                rj(e);
                addModeSetHistoryEntry(newmode, e);
            },
            print: log,
            callProc: function() {
                return pi.client.callProc.apply(pi.client, arguments);
            },
        };

        const context = vm.createContext(sandbox);
        const script = new vm.Script(code);
        script.runInContext(context);
    });
}
