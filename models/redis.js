'use strict';

var _ = require("lodash"),
    q = require('q');

var getActiveKeys = function(){
    var dfd = q.defer();
    redis.keys("bull:*:active", function(err, keys){
        dfd.resolve(keys);
    });
    return dfd.promise;
};

var getCompletedKeys = function(){
    var dfd = q.defer();
    redis.keys("bull:*:completed", function(err, keys){
        dfd.resolve(keys);
    });
    return dfd.promise;
};

var getFailedKeys = function(){
    var dfd = q.defer();
    redis.keys("bull:*:failed", function(err, keys){
        dfd.resolve(keys);
    });
    return dfd.promise;
};

var getWaitingKeys = function(){
    var dfd = q.defer();
    redis.keys("bull:*:wait", function(err, keys){
        dfd.resolve(keys);
    });
    return dfd.promise;
};

var getStatus = function(status){
    var dfd = q.defer();
    var getStatusKeysFunction = null;
    if(status === "complete"){
        getStatusKeysFunction = getCompletedKeys;
    }else if(status === "active"){
        getStatusKeysFunction = getActiveKeys;
    }else if(status === "failed"){
        getStatusKeysFunction = getFailedKeys;
    }else if(status === "wait"){
        getStatusKeysFunction = getWaitingKeys;
    }else{
        console.log("UNSUPPORTED STATUS:", status);
        return;
    }

    getStatusKeysFunction().done(function(keys){
        var multi = [];
        var statusKeys = [];
        for(var i = 0, ii = keys.length; i < ii; i++){
            statusKeys[keys[i].split(":")[1]] = []; // This creates an array/object thing with keys of the job type
            if(status === "active" || status === "wait"){
                multi.push(['lrange', keys[i], 0, -1]);
            }else{
                multi.push(["smembers", keys[i]]);
            }
        }
        redis.multi(multi).exec(function(err, data){
            var statusKeyKeys = Object.keys(statusKeys); // Get the keys from the object we created earlier...
            var count = 0;
            for(var k = 0, kk = data.length; k < kk; k++){
                statusKeys[statusKeyKeys[k]] = data[k];
                count += data[k].length;
            }
            dfd.resolve({keys: statusKeys, count: count});
        });
    });
    return dfd.promise;
};

var getAllKeys = function(){
    var dfd = q.defer();
    redis.keys("bull:*:[0-9]*", function(err, keys){
        dfd.resolve(keys);
    });
    return dfd.promise;
};

var getFullKeyNamesFromIds = function(list){
    if(!list) return;
    if(!(list instanceof Array)) return;
    var dfd = q.defer();
    var keys = [];
    for(var i = 0, ii = list.length; i < ii; i++){
        keys.push(["keys", "bull:*:"+list[i]]);
    }

    redis.multi(keys).exec(function(err, arrayOfArrays){
        var results = [];
        for(var i = 0, ii = arrayOfArrays.length; i < ii; i++){
            if(arrayOfArrays[i].length === 1){
                results.push(arrayOfArrays[i][0]);
            }
        }
        dfd.resolve(results);
    });
    return dfd.promise;
}

var getJobsInList = function(list){
    if(!list) return;
    var dfd = q.defer();
    var jobs = [];

    if(list["keys"]){
        //New list type
        var keys = list["keys"];
        var objectKeys = Object.keys(keys);
        var fullNames = [];
        for(var i = 0, ii = objectKeys.length; i < ii; i++){
            for(var k = 0, kk = keys[objectKeys[i]].length; k < kk; k++){
                fullNames.push("bull:"+objectKeys[i]+":"+keys[objectKeys[i]][k]);
            }
        }
        dfd.resolve(fullNames);
    }else{
        //Old list type
        getFullKeyNamesFromIds(list).done(function(keys){
           dfd.resolve(keys);
        });
    }
   return dfd.promise;
};

var getStatusCounts = function(){
    var dfd = q.defer();
    getStatus("active").done(function(active){
        getStatus("complete").done(function(completed){
            getStatus("failed").done(function(failed){
                getStatus("wait").done(function(pendingKeys){
                    getAllKeys().done(function(allKeys){
                        var countObject = {
                            active: active.count,
                            complete: completed.count,
                            failed: failed.count,
                            pending: pendingKeys.count,
                            total: allKeys.length,
                            stuck: allKeys.length - (active.count+completed.count+failed.count+pendingKeys.count)
                        };
                        dfd.resolve(countObject);
                    });
                });
            });
        });
    });
    return dfd.promise;
};

var formatKeys = function(keys){
    if(!keys) return;

    var dfd = q.defer();
    getStatus("failed").done(function(failedJobs){
        getStatus("complete").done(function(completedJobs){
            getStatus("active").done(function(activeJobs){
                getStatus("wait").done(function(pendingJobs){
                    var keyList = [];
                    for(var i = 0, ii = keys.length; i < ii; i++){
                        var explodedKeys = keys[i].split(":");
                        var status = "stuck";
                        if(activeJobs.keys[explodedKeys[1]] && activeJobs.keys[explodedKeys[1]].indexOf(explodedKeys[2]) !== -1) status = "active";
                        else if(completedJobs.keys[explodedKeys[1]] && completedJobs.keys[explodedKeys[1]].indexOf(explodedKeys[2]) !== -1) status = "complete";
                        else if(failedJobs.keys[explodedKeys[1]] && failedJobs.keys[explodedKeys[1]].indexOf(explodedKeys[2]) !== -1) status = "failed";
                        else if(pendingJobs.keys[explodedKeys[1]] && pendingJobs.keys[explodedKeys[1]].indexOf(explodedKeys[2]) !== -1) status = "pending";
                        keyList.push({id: explodedKeys[2], type: explodedKeys[1], status: status});
                    }
                    keyList = _.sortBy(keyList, function(key){return parseInt(key.id);});
                    dfd.resolve(keyList);
                });
            });
        });
    });
    return dfd.promise;
};

var makeJobInactiveById = function(id){
    var dfd = q.defer();
    redis.lrem("bull:video transcoding:active", 0, id, function(err, data){
        dfd.resolve(data);
    });
    return dfd.promise;
};

var makeJobIncompleteById = function(id){
    var dfd = q.defer();
    redis.srem("bull:video transcoding:completed", id, function(err, data){
        dfd.resolve(data);
    });
    return dfd.promise;
};

var makeJobNotFailedById = function(id){
    var dfd = q.defer();
    redis.srem("bull:video transcoding:failed", id, function(err, data){
        dfd.resolve(data);
    });
    return dfd.promise;
};

var removeJobs = function(list){
    if(!list) return;
    //Expects {id: 123, type: "video transcoding"}

    var multi = [];
    for(var i = 0, ii = list.length; i < ii; i++){
        var firstPartOfKey = "bull:"+list[i].type+":";
        multi.push(["del", firstPartOfKey+list[i].id]);
        multi.push(["lrem", firstPartOfKey+"active", 0, list[i].id]);
        multi.push(["lrem", firstPartOfKey+"wait", 0, list[i].id]);
        multi.push(["srem", firstPartOfKey+"completed", list[i].id]);
        multi.push(["srem", firstPartOfKey+"failed", list[i].id]);
    }
    redis.multi(multi).exec();
};

module.exports.getAllKeys = getAllKeys; //Returns all JOB keys in string form (ex: bull:video transcoding:101)
module.exports.formatKeys = formatKeys; //Returns all keys in object form, with status applied to object. Ex: {id: 101, type: "video transcoding", status: "pending"}
module.exports.getStatus = getStatus; //Returns indexes of completed jobs
module.exports.getStatusCounts = getStatusCounts; //Returns counts for different statuses
module.exports.getJobsInList = getJobsInList; //Returns the job data from a list of job ids
module.exports.removeJobs = removeJobs; //Removes one or  more jobs by ID, also removes the job from any state list it's in