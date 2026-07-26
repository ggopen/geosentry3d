/** 第三方库类型声明（density-clustering / concaveman 无官方 TS 类型） */

declare module 'density-clustering' {
  export class DBSCAN {
    run(dataset: number[][], neighborhoodRadius: number, minPoints: number, distanceFunction?: (a: number[], b: number[]) => number): number[][]
    noise: number[]
  }
  export class OPTICS {
    run(dataset: number[][], neighborhoodRadius: number, minPoints: number, distanceFunction?: (a: number[], b: number[]) => number): number[][]
  }
  export class KMEANS {
    run(dataset: number[][], k: number): number[][]
  }
}

declare module 'concaveman' {
  /** 快速凹包（concave hull）：输入点集，返回沿边界的点序列 */
  export default function concaveman<T extends number[]>(
    points: T[],
    concavity?: number,
    lengthThreshold?: number
  ): T[]
}
