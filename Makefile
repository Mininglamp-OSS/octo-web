build:
	docker build -t tsdaodaoweb .
deploy:
	docker build -t tsdaodaoweb  .
	docker tag tsdaodaoweb registry.cn-shanghai.aliyuncs.com/wukongim/tsdaodaoweb:latest
	docker push registry.cn-shanghai.aliyuncs.com/wukongim/tsdaodaoweb:latest