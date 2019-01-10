var spectrumfft2spl = function(fileString,decibels){

var parseValue = function(v){
  if(!isNaN(v)){
      var f = parseFloat(v);
      if(!isNaN(f)){
        return f;
      }
  }
  return v;
}
var keys, values;
var closestIndexOf = function(a,v){
  var idx = a.indexOf(v);
  if(idx<0){
    var start = a.indexOf(0);
    var diff = Math.pow(2,31);
    for (var i=start;i<a.length;i++){
      if(!isNaN(a[i])){
        if(Math.abs(v-a[i])<=diff){
          idx = i;
          diff = Math.abs(v-a[i]);
        }else{
          break;
        }
      }
    }
  }
  return idx;
}
var BUCKET_SECONDS = 20;
var AVERAGE_COL_START = 3;
var timeRegex = /^(\d\d):(\d\d):(\d\d)$/;

var time2seconds = function(s){
  if(s && s.match(timeRegex)){
    var parts = s.split(":").map(function(t){return parseInt(t)});
    var t = parts[0]*60*60+parts[1]*60+parts[2];
    return t;
  }
  return s;
}
var pad0 = function(s){return (""+s).length>1?s:("0"+s)};
var seconds2time = function(t){
  if(!isNaN(t)){
    var s = t%60;
    var m = (t-s)/60%60;
    var h = (t-m*60-s)/60/60;
    return pad0(h)+":"+pad0(m)+":"+pad0(s);
  }
  return t;
}
function averaged(bucket,startCol){
  var n = bucket.length;
  var total = bucket.shift().slice(0);
  while(bucket.length){
    var line = bucket.shift();
    for(var i=startCol;i<line.length;i++){
      total[i] += line[i];
    }
  }
  for(var i=startCol;i<total.length;i++){
    total[i] /= n;
  }
  return total;
}
/**
 * aggregate lines into buckets up to limit seconds
 */
function buckets(rows,limit){
  var bucket;
  var bkts = [];
  rows.forEach(function(row){
    if(bucket && Math.abs(bucket[0][0]-row[0])<limit){
      bucket.push(row.slice(0));
    }else{
      bucket = Array();
      bucket.push(row.slice(0));
      bkts.push(bucket);
    }
  });
  return bkts;
}
/*
 * Parse a string containing the contents of Ocean Sonics Hydrophone fft file.
 * See: http://spiddal.marine.ie/data/hydrophones/SBF1323/2019/01/10/
 * Also see hydrophone feed at mqtt.marine.ie
 */
var parseFFT = function(decibels, fileString){
  var lines =  fileString.split("\n");
  var setup = {};
  while(lines.length>0){
    var line = lines.shift();
    var parts = line.split(/\t/);
    if(parts.length == 2){
      setup[parts[0]] = parseValue(parts[1]);
      continue;
    }
    if(parts[0] == "Data:"){
      break;
    }
  }
  if(setup["Time Zone"] !== "UTC"){
    //see date processing below...
    throw new Error("The timezone is not in UTC, so the processing code needs updated first.")
  }
  var offset = setup["dB Ref re 1uPa"];
  if(lines.length<2){
      return null;
  }
    keys = lines.shift().split(/\t/).map(function(v){return parseValue(v)});
    data = lines.map(function(line){
      return line.split(/\t/).map(function(v){return parseValue(v)})
    }).map(function(row){
      row[0] = time2seconds(row[0]);
      return row;
    });
    /*
     * remove rubbish at end of file
     */
    while(data.length>0 && data[data.length-1].length<setup["Accumulations"]){
      data.pop();
    }
    /*
     * load the data into buckets and calculate averages.
     */
    var wanted = buckets(data,BUCKET_SECONDS).map(function(bucket){
      var a = averaged(bucket,AVERAGE_COL_START);
      a[0] = seconds2time(a[0]);
      return a;
    });
    /*
     * unhandled case where date rolls over.
     */
    while(data.length>0 && data[data.length-1][0]<setup["Start Time"]){
      // see date processing below.
      console.log("Discarding next day data, fix this processing code to save");
      data.pop();
    }
    var results = [];
    wanted.forEach(function(values){
      /*
       * metadata much the same on all records, but that's big data for you...
       */
      var result = {
        "time": setup["Start Date"]+"T"+values[0]+"Z",// date processing
        "instrument_id": setup["Model"]+setup["S/N"],
        "device": setup["Device"],
        "model": setup["Model"],
        "serial_no": setup["S/N"],
        "sample_rate": setup["Sample Rate [S/s]"],
        "fft_size": setup["FFT Size"],
        "bin_width_Hz": setup["Bin Width [Hz]"],
        "dB_Ref_re_1V": parseValue(setup["dB Ref re 1V"]),
        "dB_Ref_re_1uPa": parseValue(setup["dB Ref re 1uPa"]),
      };
      decibels.forEach(function(db){
        if(result.bin_width_Hz <= db){
          var idx = closestIndexOf(keys,db);
          result["dB_re_1u_Pa_"+db+"Hz"] = idx >=0? values[idx] : null;
        }
      });
      var total = values.slice(keys.indexOf(0)+1).map(function(v){return Math.pow(10,(v/10));}).reduce(function(v,t){return v+t});
      var spl_total = 10*Math.log10(total)+offset;
      result.SPL_Total = spl_total;
      results.push({payload: result});
    });
    
  return [results];
  }

  return parseFFT(decibels?decibels:[63,125,1000,2000],fileString);
}

