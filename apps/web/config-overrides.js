var path = require('path')

const { override, babelInclude, addWebpackPlugin } = require('customize-cra')
const UglifyJsPlugin = require('uglifyjs-webpack-plugin')
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');

// module.exports = override(
// 	// 注意是production环境启动该plugin
// 	process.env.NODE_ENV === 'production' && addWebpackPlugin(
//   	new UglifyJsPlugin({
//   		// 开启打包缓存
//   		cache: true,
//   		// 开启多线程打包
//   		parallel: true,
//   		uglifyOptions: {
//   			// 删除警告
//   			warnings: false,
//   			// 压缩
//   			compress: {
//   				// 移除console
//   				drop_console: true,
//   				// 移除debugger
//   				drop_debugger: true
//   			}
//   		}
//   	})
//   )
// )

module.exports = function (config, env) {
  if (process.env.NODE_ENV === 'production') {
    config.devtool = false;
  }
  return Object.assign(
    config,
    override(
      // 判断环境变量ANALYZER参数的值
      process.env.ANALYZER && addWebpackPlugin(new BundleAnalyzerPlugin()),
      process.env.NODE_ENV === 'production' && addWebpackPlugin(
        new UglifyJsPlugin({
          cache: true,
          // 开启多线程打包
          parallel: true,
          uglifyOptions: {
            // 删除警告
            warnings: false,
            // 压缩
            compress: {
              // 移除console
              drop_console: true,
              // 移除debugger
              drop_debugger: true
            }
          },
        })
      ),
      babelInclude([
        /* transpile (converting to es5) code in src/ and shared component library */
        path.resolve('src'),
        path.resolve('../../packages'),
      ])
    )(config, env)
  )
}