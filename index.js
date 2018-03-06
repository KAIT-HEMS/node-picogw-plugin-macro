const vm = require('vm');

let pi;
let log = console.log; // eslint-disable-line no-unused-vars
let localStorage;
let modeSetHistory;
const MODE_SET_HISTORY_ENTRY_MAX = 100;

let modeCheckTimerID;

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

    resetPolling();
};

function resetPolling(newInterval) {
    if (modeCheckTimerID != null) {
        clearInterval(modeCheckTimerID);
    }
    modeCheckTimerID = null;

    if (newInterval == null) {
        const settings = pi.setting.getSettings();
        newInterval = settings.triggers.pollingInterval;
    }
    if (typeof newInterval == 'number') {
        modeCheckTimerID = setInterval(()=>{
            onProcCallGet('mode').catch((e)=>{});
        }, newInterval * 1000);
    }
}

/**
 * Setting value rewriting event for UI
 * @param {object} newSettings Settings edited for UI
 * @return {object} Settings to save
 */
function onUISetSettings(newSettings) {
    resetPolling(newSettings.triggers.pollingInterval);
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

function getLastMode() {
    if (modeSetHistory.length == 0) {
        return null;
    }
    return modeSetHistory[0].mode;
}

function onProcCallGet(path, args) {
    if (path != 'mode') {
        return {mode: {}};
    }
    if (args == null) args = {};

    const settings = pi.setting.getSettings();

    switch (args.type) {
    case 'history':
        const ret = modeSetHistory.filter((entry)=>{
            return entry.mode == args.mode;
        });

        return {data: ret.slice(0, args.limit||50)};
    default:
        return new Promise((ac, rj)=>{
            const sandbox = {
                resolve: (re)=>{
                    ac({value: re, leaf: true});
                    if (re !== getLastMode()) {
                        addModeSetHistoryEntry(re, {value: re, leaf: true});
                    }
                    resetPolling();
                },
                reject: (e)=>{
                    rj({errors: [e], leaf: true});
                    // resetPolling();
                },
                print: log,
                callProc: function() {
                    return pi.client.callProc.apply(pi.client, arguments);
                },
            };

            const context = vm.createContext(sandbox);
            const script = new vm.Script(settings.triggers.check_mode);
            script.runInContext(context);
        });
    }
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
                if (newmode !== getLastMode()) {
                    addModeSetHistoryEntry(newmode, re);
                }
                resetPolling();
            },
            reject: (e)=>{
                rj(e);
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
