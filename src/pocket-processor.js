class PocketProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.hopSize = 512;
    this.lowCoefficient = 1 - Math.exp(-2 * Math.PI * 180 / sampleRate);
    this.midCoefficient = 1 - Math.exp(-2 * Math.PI * 2500 / sampleRate);
    this.lowPass = [];
    this.midPass = [];
    this.resetFrame();
    this.port.onmessage = (event) => {
      if (event.data?.type === "reset") {
        this.lowPass = [];
        this.midPass = [];
        this.resetFrame();
      }
    };
  }

  resetFrame() {
    this.samples = 0;
    this.fullPower = 0;
    this.lowPower = 0;
    this.midPower = 0;
    this.highPower = 0;
  }

  static decibels(power) {
    return 10 * Math.log10(Math.max(1e-12, power));
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    const frameLength = output[0]?.length ?? input[0]?.length ?? 128;

    for (let channel = 0; channel < output.length; channel += 1) {
      const source = input[channel] ?? input[0];
      if (source) output[channel].set(source);
      else output[channel].fill(0);
    }

    for (let index = 0; index < frameLength; index += 1) {
      const channelCount = Math.max(1, input.length, this.lowPass.length);
      let fullPower = 0;
      let lowPower = 0;
      let midPower = 0;
      let highPower = 0;

      for (let channel = 0; channel < channelCount; channel += 1) {
        const sample = input[channel]?.[index] ?? 0;
        const previousLow = this.lowPass[channel] ?? 0;
        const previousMid = this.midPass[channel] ?? 0;
        const filteredLow = previousLow + this.lowCoefficient * (sample - previousLow);
        const filteredMid = previousMid + this.midCoefficient * (sample - previousMid);
        this.lowPass[channel] = filteredLow;
        this.midPass[channel] = filteredMid;
        const low = filteredLow;
        const mid = filteredMid - filteredLow;
        const high = sample - filteredMid;
        fullPower += sample * sample;
        lowPower += low * low;
        midPower += mid * mid;
        highPower += high * high;
      }

      this.fullPower += fullPower / channelCount;
      this.lowPower += lowPower / channelCount;
      this.midPower += midPower / channelCount;
      this.highPower += highPower / channelCount;
      this.samples += 1;

      if (this.samples >= this.hopSize) {
        const time = currentTime + (index + 1) / sampleRate;
        this.port.postMessage({
          time,
          full: PocketProcessor.decibels(this.fullPower / this.samples),
          low: PocketProcessor.decibels(this.lowPower / this.samples),
          mid: PocketProcessor.decibels(this.midPower / this.samples),
          high: PocketProcessor.decibels(this.highPower / this.samples)
        });
        this.resetFrame();
      }
    }

    return true;
  }
}

registerProcessor("pocket-processor", PocketProcessor);
