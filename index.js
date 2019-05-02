const vm = require('vm');
const moment = require('moment');

let pi;
let log = console.log; // eslint-disable-line no-unused-vars
let localStorage;
let pollLog;

let pollTimerID;

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

    pollLog = localStorage.getItem('pollLog', []);

    resetPolling();
};

/**
 * Setting value rewriting event for UI
 * @param {object} newSettings Settings edited for UI
 * @return {object} Settings to save
 */
function onUISetSettings(newSettings) {
    resetPolling(newSettings.Periodical.pollInterval);

    pollLog = pollLog.slice(
	    0,　newSettings.Periodical.pollLogEntryMax );
    localStorage.setItem('pollLog', pollLog);

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
    case 'DELETE': return onProcCallDelete(path, args);
    }
    return {error: `The specified method ${method} is not implemented in this plugin.`};
}

function onProcCallGet(path, args) {
    const settings = pi.setting.getSettings();
    if (args == null) args = {};

    switch (path) {
    case 'log': return {data: pollLog};
    case 'run': return new Promise((ac, rj)=>{
        const sandbox = {
            resolve: (re)=>{ac({value: re}); },
            reject: (e)=>{ rj({errors: [e]}); },
            addLog: addPollLogEntry,
            getArgs:()=>args,
            print: console.log,
            callProc: function() {
                return pi.client.callProc.apply(pi.client, arguments);
            },
        };

        const context = vm.createContext(sandbox);
        const script = new vm.Script('(async function(){'
            +settings.OnDemand.code
            +"\nresolve({success:true,message:'The code ended without resolve/reject.'})})()");
        script.runInContext(context);
    });
    default:
        return {run: {}, log: {}};
    }
}

function onProcCallDelete(path, args) {
    const settings = pi.setting.getSettings();
    if (args == null) args = {};

    if( path == '' ){
	localStorage.setItem('pollLog', []);
    } else {
	switch (path) {
	case 'log': localStorage.setItem('pollLog', []); break ;
	default:
	    return {errors:[{
		error:`Cannot delete "${path}" property`,
		message:`Cannot delete "${path}" property`
	    }]};
	}
    }
    pollLog = localStorage.getItem('pollLog', []);
    return {success:true,message:'The log data was successfully cleared.'};
}

// ////////////////////////////////
//     Periodical logging

// Start polling for periodic log
function resetPolling(newIntervalInMinutes) {
    if (pollTimerID != null) {
        clearTimeout(pollTimerID);
    }
    pollTimerID = null;
    if (newIntervalInMinutes == null) {
        const settings = pi.setting.getSettings();
        newIntervalInMinutes = settings.Periodical.pollInterval;
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
        pollTimerID
            = setTimeout(runPollScript
                , nextTiming - millisDiff + 1000 /* margin*/);
    }
}

function runPollScript() {
    const sandbox = {
        addLog: addPollLogEntry,
        print: console.log,
        callProc: function() {
            return pi.client.callProc.apply(pi.client, arguments);
        },
    };

    resetPolling();

    const context = vm.createContext(sandbox);
    const settings = pi.setting.getSettings();
    const script = new vm.Script('(async function(){'+settings.Periodical.code+"\n})()");
    script.runInContext(context);
}


function addPollLogEntry(name, value) {
    const curDate = new Date();

    const logEntry = {
        created_at: moment(curDate).format('YYYY/MM/DD HH:mm:ss'),
        timestamp: curDate.getTime(),
        name: name,
        value: value,
    };

    pollLog.unshift(logEntry);

    pollLog = pollLog.slice(0, pi.setting.getSettings().Periodical.pollLogEntryMax);
    localStorage.setItem('pollLog', pollLog);

    pi.server.publish('log', logEntry);
}

