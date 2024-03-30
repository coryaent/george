"use strict";

const Docker = require ('dockerode');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const axios = require ('axios');
const fs = require ('node:fs');

const docker = new Docker ();
const adminToken = fs.readFileSync (process.env.GARAGE_ADMIN_TOKEN_FILE).toString ();

docker.listServices ({
    "filters": `{"name": ["${process.env.GARAGE_SERVICE_NAME}"]}`
}).then (async function main (serviceList) {
    // filtering by name yields one service
    garageService = serviceList[0];

    // check which mode the service is in and find expected task number
    let globalNodes = [];
    let expectedTasks = 0;
    if (garageService.Spec.Mode.Replicated) {
        // if replicated just use the given value of replicas
        expectedTasks = garageService.Spec.Mode.Replicated.Replicas;
    }
    if (garageService.Spec.Mode.Global) {
        // need to count number of nodes that satisfy the placement constraint
        globalNodes = await docker.listNodes ({
            "filters": `{"node.label":{"${process.env.GARAGE_PLACEMENT_LABEL}=true":true}}`
        });
        expectedTasks = globalNodes.length;
    }
    console.debug ("Found", expectedTasks, "expected task(s).");

    // check that each task is ready
    let garageTasks = [];
    let failCounter = -1;
    let runningTasks = 0;
    // after breaking out of the loop all the tasks are running
    while (runningTasks < expectedTasks) {
        // list of garage tasks
        garageTasks= await docker.listTasks ({
            "filters": `{"service":["${process.env.GARAGE_SERVICE_NAME}"]}`
        });
        // filter further to running garage tasks
        runningTasks = garageTasks.filter (task => {
            task.Status.State === "running";
        }).length;
        console.debug ("Found", runningTasks, "running task(s) out of", expectedTasks, "expected.");
        await sleep (2000);
        // fail after five minutes
        failCounter++;
        if (failCounter === 150) {
            console.error ("Could not find all expected tasks.");
            process.exit (1);
        }
    }

    // get the swarm node ID's from the garage tasks
    swarmNodeIDs = garageTasks.map (task => {
        task.NodeID;
    });
    // this array will hold both swarm and garage data (collectively called "nodes")
    let nodes = [];
    // iterate over the swarm node ID's
    for (let swarmID of swarmNodeIDs) {
        // object that will go in the array
        let node = {};
        // this property may be an unneccesary appendage
        node.swarmID = swarmID;
        // get details for each swarm node
        let swarmNode = await docker.getNode (swarmID);
        // public IP address
        node.ip = swarmNode.Status.Addr;
        // read configuration labels
        node.zone = swarmNode.Spec.Labels[process.env.GARAGE_ZONE_LABEL];
        node.capacity = swarmNode.Spec.Labels[process.env.GARAGE_CAPACITY_LABEL];
        // tags needs to be set to avoid calling .split (',') on an undefined value
        node.tags = swarmNode.Spec.Labels[process.env.GARAGE_TAGS_LABEL] || "";
        // get the garage node ID
        let garageStatus = await axios.get ({
            "url": `https://${node.ip}:${process.env.GARAGE_ADMIN_PORT}/status`,
            "headers": {
                "Authorization": `Bearer ${adminToken}`
            }
        });
        // set the garage node ID
        node.garageID = garageStatus.data.node;
        // add the node to the array
        nodes.push (node);
    }

    // connect the nodes together
    let peers = nodes.map (node => `${node.garageID}@${node.ip}:${process.env.GARAGE_RPC_PORT}`);
    await axios.post ({
        "url": `https://${nodes[0].ip}:${process.env.GARAGE_ADMIN_PORT}/connect`,
        "headers": {
            "Authorization": `Bearer ${adminToken}`
        },
        "data": peers
    });

    // wait for the gossip to spread
    let healthCheck = `https://${nodes[nodes.length - 1].ip}:${process.env.GARAGE_ADMIN_PORT}/health`;
    let healthReport = null;
    let connections = 0;
    failCounter = -1;
    while (connections < peers.length) {
        healthReport = await axios.get ({
            "url": healthCheck,
            "headers": {
                "Authorization": `Bearer ${adminToken}`
            },
        });
        connections = healthReport.data.connectedNodes;
        await sleep (2000);
        failCounter++;
        if (failCounter === 150) {
            console.error ("Could not find", peers.length, "connected nodes. Gossip did not spread.");
            process.exit (1);
        }
    }

    // get current layout version (use last node in array because its known healthy)
    let layoutEndpoint = `https://${nodes[nodes.length - 1].ip}:${process.env.GARAGE_ADMIN_PORT}/layout`;
    let vCurrentLayout = (await axios.get ({
        "url": layoutEndpoint,
        "headers": {
            "Authorization": `Bearer ${adminToken}`
        },
    })).data.version;

    // prepare the modification data
    let layoutMod = nodes.map (node => new Object ({
        "id": node.garageID,
        "zone": node.zone,
        "capacity": Number.parseInt (node.capacity) || null,
        "tags": node.tags.split (',');
    }));

    // push the new layout to staging
    await axios.post ({
        "url": layoutEndpoint,
        "headers": {
            "Authorization": `Bearer ${adminToken}`
        },
    });

    // apply the new layout
    await axios.post ({
        "url": `${layoutEndpoint}/apply`,
        "headers": {
            "Authorization": `Bearer ${adminToken}`
        },
        "data": {
            "version": ++vCurrentLayout
        }
    });

    process.exit (0);
});
