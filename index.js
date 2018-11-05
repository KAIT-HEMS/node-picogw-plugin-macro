const vm = require('vm');
const moment = require('moment');

let pi;
let log = console.log; // eslint-disable-line no-unused-vars
let localStorage;
let modeSetHistory;
let periodicalLog;
const MODE_SET_HISTORY_ENTRY_MAX = 100;
const PERIODICAL_LOG_ENTRY_MAX = 300;

let modePollingTimerID;
let periodicalLogTimerID;

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
    periodicalLog = localStorage.getItem('periodicalLog', []);

    resetModePolling();
    resetGetPeriodicalLogPolling();
};


/**
 * Setting value rewriting event for UI
 * @param {object} newSettings Settings edited for UI
 * @return {object} Settings to save
 */
function onUISetSettings(newSettings) {
    resetModePolling(newSettings.GET.modePollingInterval);
    resetGetPeriodicalLogPolling(newSettings.GET.periodicalLogInterval);
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
    case 'DELETE': return onProcCallDelete(path, args);
    }
    return {error: `The specified method ${method} is not implemented in this plugin.`};
}

function onProcCallGet(path, args) {
    const settings = pi.setting.getSettings();
    if (args == null) args = {};

    function onModeHistory() {
        const ret = modeSetHistory.filter((entry)=>{
            return args.mode == null || entry.mode == args.mode;
        });

        return {data: ret.slice(0, args.limit||50)};
    }
    function onMode() {
        switch (args.type) {
        case 'history':
            return onModeHistory();
        default:
            return new Promise((ac, rj)=>{
                const sandbox = {
                    resolve: (re)=>{
                        ac({value: re});
                        if (re !== getLastMode()) {
                            addModeSetHistoryEntry(re, {value: re});
                        }
                        resetModePolling();
                    },
                    reject: (e)=>{
                        rj({errors: [e]});
                        // resetModePolling();
                    },
                    addLog: addPeriodicalLogEntry,
                    print: log,
                    callProc: function() {
                        return pi.client.callProc.apply(pi.client, arguments);
                    },
                };

                const context = vm.createContext(sandbox);
                const script = new vm.Script('(async function(){'+settings.GET.check_mode+'})()');
                script.runInContext(context);
            });
        }
    }


    switch (path) {
    case 'mode': return onMode();
    case 'modeHistory': return onModeHistory();
    case 'log': return {data: periodicalLog};
    default:
        return {mode: {}, modeHistory: {}, log: {}};
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

    return new Promise((ac, rj)=>{
        const sandbox = {
            ARGS: args,
            resolve: (re)=>{
                ac(re);
                if (newmode !== getLastMode()) {
                    addModeSetHistoryEntry(newmode, re);
                }
                resetModePolling();
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
        const script = new vm.Script('(async function(){'+settings.PUT.put_mode+'})()');
        script.runInContext(context);
    });
}

function onProcCallDelete(path, args) {
    const settings = pi.setting.getSettings();
    if (args == null) args = {};

    if( path == '' ){
	localStorage.setItem('modeSetHistory', []);
	localStorage.setItem('periodicalLog', []);
    } else {
	switch (path) {
	case 'modeHistory': localStorage.setItem('modeSetHistory', []); break ;
	case 'log': localStorage.setItem('periodicalLog', []); break ;
	default:
	    return {errors:[{
		error:`Cannot delete "${path}" property`,
		message:`Cannot delete "${path}" property`
	    }]};
	}
    }
    modeSetHistory = localStorage.getItem('modeSetHistory', []);
    periodicalLog = localStorage.getItem('periodicalLog', []);
    return {success:true,message:'The log data was successfully cleared.'};
}

// ////////////////////////////////
//     Mode change detection

// Start polling for detecting mode change
function resetModePolling(newInterval) {
    if (modePollingTimerID != null) {
        clearInterval(modePollingTimerID);
    }
    modePollingTimerID = null;

    if (newInterval == null) {
        const settings = pi.setting.getSettings();
        newInterval = settings.GET.modePollingInterval;
    }
    if (typeof newInterval == 'number') {
        modePollingTimerID = setInterval(()=>{
            onProcCallGet('mode').catch((e)=>{});
        }, newInterval * 1000);
    }
}


function addModeSetHistoryEntry(newmode, result) {
    const id = (
        modeSetHistory.length==0
            ? 0
            : modeSetHistory[0].meta.id + 1);

    const curDate = new Date();
    modeSetHistory.unshift({
        created_at: moment(curDate).format('YYYY/MM/DD HH:mm:ss'),
        mode: newmode,
        // result: result, // (Can cause big log)
        meta: {
            id: id,
            timestamp: Math.floor(curDate.getTime()/1000),
        },
    });

    modeSetHistory = modeSetHistory.slice(0, MODE_SET_HISTORY_ENTRY_MAX);
    localStorage.setItem('modeSetHistory', modeSetHistory);

    pi.server.publish('mode', {value: newmode});
};

function getLastMode() {
    if (modeSetHistory.length == 0) {
        return null;
    }
    return modeSetHistory[0].mode;
}


// ////////////////////////////////
//     Periodical logging

// Start polling for periodic log
function resetGetPeriodicalLogPolling(newIntervalInMinutes) {
    if (periodicalLogTimerID != null) {
        clearTimeout(periodicalLogTimerID);
    }
    periodicalLogTimerID = null;
    if (newIntervalInMinutes == null) {
        const settings = pi.setting.getSettings();
        newIntervalInMinutes = settings.GET.periodicalLogInterval;
    }
    if (typeof newIntervalInMinutes == 'number') {
        const curDate = new Date();
        // Align by nearest hour
        const alignedDate = new Date(
            curDate.getFullYear(), curDate.getMonth(), curDate.getDate(), curDate.getHours());
        const millisDiff = curDate.getTime() - alignedDate.getTime();
        let nextTiming = 0;
        while (nextTiming < millisDiff) {
            nextTiming += newIntervalInMinutes * 60*1000;
        }
        if (nextTiming >= 60*60*1000) {
            nextTiming = 60*60*1000;
        }
        periodicalLogTimerID
            = setTimeout(runGetPeriodicalLogScript
                , nextTiming - millisDiff + 1000 /* margin*/);
    }
}

function runGetPeriodicalLogScript() {
    const sandbox = {
        addLog: addPeriodicalLogEntry,
        print: log,
        callProc: function() {
            return pi.client.callProc.apply(pi.client, arguments);
        },
    };

    resetGetPeriodicalLogPolling();

    const context = vm.createContext(sandbox);
    const settings = pi.setting.getSettings();
    const script = new vm.Script('(async function(){'+settings.GET.getPeriodicalLog+'})()');
    script.runInContext(context);
}


function addPeriodicalLogEntry(name, value) {
    const id = (
        periodicalLog.length==0
            ? 0
            : periodicalLog[0].meta.id + 1);

    const curDate = new Date();
    periodicalLog.unshift({
        created_at: moment(curDate).format('YYYY/MM/DD HH:mm:ss'),
        name: name,
        value: value,
        meta: {
            id: id,
            timestamp: Math.floor(curDate.getTime()/1000),
        },
    });

    periodicalLog = periodicalLog.slice(0, PERIODICAL_LOG_ENTRY_MAX);
    localStorage.setItem('periodicalLog', periodicalLog);
}

