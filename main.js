// Load dependency's
const utils = require("@iobroker/adapter-core");
const net = require("net");
const SerialPort = require('serialport')
const Readline = require('@serialport/parser-readline')
const attributes = require('./lib/object_definition.js');
const checkhex = require(__dirname + '/lib/otgwdec');
const translatehex = require(__dirname + '/lib/openthermdec');
let client, values, objtype, serialPort

// Create the adapter and define its methods
const adapter = utils.adapter({
	name: "opentherm",
	// The ready callback is called when databases are connected and adapter received configuration.
	ready: main, // Main method defined below for readability

	// is called when adapter shuts down - callback has to be called under any circumstances!
	unload: (callback) => {
		try {
			const useUSB = adapter.config.byUSB
			const useTCP = adapter.config.byTCPIP

			if (useTCP){

				client.end();
				
			}			
			
			if(useUSB) {
				serialPort.close()
				adapter.log.info("Opentherm Terminated, all USB connections closed")
			}
			
			// Write message in log related to server connection
			client.on('end', function() {
				// Need to add logic for retry / restart
				adapter.log.warn('OpenTherm : disconnected from OpenTherm Gateway');

			});

//			serialPort.on('error', function(error) {
			serialPort.on('close', function(){
				adapter.log.warn('OpenTherm : disconnected from OpenTherm Gateway');
			});

			callback();

		} catch (error) {

			adapter.log.warn(error);
			callback();
		}
	},
});

// const devData = true;
// const devLogging = false;
function main() {
	const ipaddr = adapter.config.ipaddr;
	const otport = adapter.config.port;
	const useUSB = adapter.config.byUSB
	const useTCP = adapter.config.byTCPIP
	const USB_Device = adapter.config.USBDevice

	// Write connection status
	doStateCreate("info.Connection" ,"Connected","string","indicator.connected","",false);
	adapter.setState("info.Connection", { val: false, ack: true });

//		adapter.subscribeStates("*");

	if (useUSB){

		// Handle USB connection
		try {
			serialPort = new SerialPort(USB_Device);
			adapter.log.info('OpenTherm : Succesfully connected on : ' + "/dev/ttyUSB0");
			adapter.setState("info.Connection", { val: true, ack: true });
		} catch (error) {
			adapter.log.info(error)
		}
		// Connection error handling
		serialPort.on('error', function(error) {
			adapter.log.error(JSON.stringify(error));
			adapter.setState("info.Connection", { val: (JSON.stringify(error)), ack: true });
		});


		const parser = serialPort.pipe(new Readline({ delimiter: '\r\n' }))
		parser.on('data', function(data) {
			
			datahandler(data)

		});

		// Event at succefull connection by USB
		serialPort.on('open', function(error) {
		
			// Get a list of all USB devices
			SerialPort.list(function (err, results) {
				if (err) {
				throw err;
				}
			});
		});

	}

	if(useTCP){
		var completeData = '';
		// Handle TCP-IP connection
		try {
			// @ts-ignore 
			client = net.connect({ host: ipaddr, port: otport},
				function() { //'connect' listener
					doChannelCreate()
					adapter.log.info('OpenTherm : Succesfully connected on : ' + ipaddr);
					adapter.setState("info.Connection", { val: true, ack: true });
				});		
		} catch (error) {

		}

		// Connection error handling
		client.on('error', function(error) {
			adapter.log.error(JSON.stringify(error));
			adapter.setState("info.Connection", { val: (JSON.stringify(error)), ack: true });
		});
		client.on('data', function(data) {
			var read = data.toString();
                        completeData += read;
			// Check if data is correct. Only one data line to datahandler
			if (completeData.match(/\r\n/)) {
                                //adapter.log.info("Response: " + completeData);
                                datahandler(completeData)
                                completeData = '';
                        }

		});
	}
}

// Handle all data and logic
function datahandler(data){
	const devData = adapter.config.DevMode
	const DevLogging = adapter.config.DevLogging
	// Write data message to log
	if (DevLogging){adapter.log.info("Data received : " + data);}
	
	// Run check on data input if received message has correct format
	const verify = checkhex.checkinput(adapter,data);

	// Only call translation function when received value is valid
	if (verify != undefined) {
		// Translate OpenTherm message to human readable objects and values
		values = translatehex.translate_input(adapter, verify);
		// Handle received data to object structure and values
		if (values != undefined) {

			if (DevLogging){adapter.log.info("Translated values : " + JSON.stringify(values));}

			// Handle array and split to unique data objects
			for (const i in values) {
				let msgType;
				objtype = toObjtype(values[i].Value);

				if (DevLogging){adapter.log.info("Values of [i] : " + i)}
				if (DevLogging){adapter.log.info("Raw values of [i] : " + JSON.stringify(values[i]))}
				if (DevLogging){adapter.log.info("Device value of [i] : " + JSON.stringify(values[i].Device))}
				//if (devLogging){adapter.log.info("Raw attribute lookkup : " + JSON.stringify(attributes))}
				if (DevLogging){adapter.log.info("attribute lookkup : " + JSON.stringify(attributes["master/status/ch"]))}
				if (DevLogging){adapter.log.info("Combined data with attribute values : " + JSON.stringify(attributes[values[i].Device]))}

				let channel = attributes[values[i].Device].channel
				let value = values[i].Value
				const name = attributes[values[i].Device].name;
				const description = attributes[values[i].Device].description;
				const role = attributes[values[i].Device].role;
				const unit = attributes[values[i].Device].unit;
				const write = attributes[values[i].Device].write;
				const cat = values[i].msgType;

				// Round values if they are numbers to ensure only 2 digits after comma
				if (objtype == "number") {
					value = Math.round(value * 10)/10
				}
				
				if (devData){
					doStateCreate("_Dev." + cat + "." + name,description,objtype,role,unit,write);
					adapter.setState("_Dev." + cat + "." + name, { val: value, ack: true });
				}
					//Write all channels to "raw" tree for developer purposes
				if (DevLogging){adapter.log.info(name + " with value : " + value + unit);}

				// Read only Read-ACK related values and store in states (we need to find out which datatype for which state must be used!)
				if (values[i].msgType == "4"){
											
					if (channel != "") {channel = channel + ".";}

					doStateCreate(channel + name,description,objtype,role,unit,write);
					adapter.setState(channel + name, { val: value, ack: true });
					if (DevLogging){adapter.log.info("Data written to state : " + name);}

				}
			}
		}
	}
}

// Function to handle state creation
function doStateCreate(id,name,type,role,unit,write) {

	adapter.setObjectNotExists(id, {
		type: "state",
		common: {
			name: name,
			type: type,
			role: role,
			read: true,
			unit: unit,
			write: write,
		},
		native: {},
	});
}

function toObjtype (value) {
	// Lets first ensure what kind of datatype we have
	if (value == 'true' || value == 'false') {
		objtype = 'boolean';
		} else if (Number.isNaN(parseFloat(value)) === false) {
			objtype = "number";
		} else {
			objtype = "string";
		}

	return objtype;
}

// Create logic channels for states
function doChannelCreate(){
	const DevLogging = adapter.config.DevLogging
	const devData = adapter.config.DevMode
	// Create channels for RAW-Data if Dev-Mode is activated
	if (devData){doChannelCreateDev();}
	
	adapter.createChannel("","config",{
		"name": "config"
	});

	adapter.createChannel("","control",{
		"name": "control"
	});

	adapter.createChannel("","fault",{
		"name": "faul"
	});

	adapter.createChannel("","info",{
		"name": "info"
	});

	adapter.createChannel("","status",{
		"name": "status"
	});

	if (DevLogging){adapter.log.info("Channels create")}

}

function doChannelCreateDev(){

	adapter.setObjectNotExists("_Dev", {
		type: "device",
		common: {
			name: "Raw data seperated by MessageType",
		},
		native: {},
	});

	adapter.createChannel("_Dev","0",{
		"name": "Read-Data || msgType : 0"
	});

	adapter.createChannel("_Dev","1",{
		"name": "Write-Data || msgType : 1"
	});

	adapter.createChannel("_Dev","2",{
		"name": "Read-Ack || msgType : 2"
	});

	adapter.createChannel("_Dev","3",{
		"name": "Write-Ack || msgType : 3"
	});

	adapter.createChannel("_Dev","4",{
		"name": "Data-Inv || msgType : 4"
	});

	adapter.createChannel("_Dev","5",{
		"name": "Unk-DataId || msgType : 5"
	});

	adapter.createChannel("_Dev","6",{
		"name": "????????? || msgType : 6"
	});

	adapter.createChannel("_Dev","7",{
		"name": "????????? || msgType : 7"
	});

	adapter.createChannel("_Dev","8",{
		"name": "????????? || msgType : 8"
	});

	adapter.log.info("Channels created")

}
